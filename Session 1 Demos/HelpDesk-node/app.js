require('dotenv').config();
const restify = require('restify');
const builder = require('botbuilder');
const ticketsApi = require('./ticketsApi');
var restifyClients = require('restify-clients');
var restifyPlugins = require('restify-plugins');
const fs = require('fs');

const path = require('path');

const listenPort = process.env.port || process.env.PORT || 3978;
const ticketSubmissionUrl = process.env.TICKET_SUBMISSION_URL || `http://localhost:${listenPort}`;

//Setup Azure Search
const azureSearch = require('./azureSearchApiClient');

const azureSearchQuery = azureSearch({
    searchName: process.env.AZURE_SEARCH_ACCOUNT,
    indexName: process.env.AZURE_SEARCH_INDEX,
    searchKey: process.env.AZURE_SEARCH_KEY
});

//Setup Text Analytics
const textAnalytics = require('./textAnalyticsApiClient');
const analyzeText = textAnalytics({
    apiKey: process.env.TEXT_ANALYTICS_KEY
});

// Setup Restify Server
var server = restify.createServer();
server.listen(listenPort, '::', () => {
    console.log('Server Up');
});

// Setup body parser and tickets api
server.use(restify.plugins.bodyParser());
server.post('/api/tickets', ticketsApi);

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

// Listen for messages from users
server.post('/api/messages', connector.listen());

//Serve Web-UI
server.get(/\/?.*/, restifyPlugins.serveStatic({
    directory: path.join(__dirname, 'web-ui'),
    default: 'default.htm'
}));

var bot = new builder.UniversalBot(connector, (session) => {
    session.endDialog(`I'm sorry, I did not understand '${session.message.text}'.\nType 'help' to know more about me :)`);
});

var luisRecognizer = new builder.LuisRecognizer(process.env.LUIS_MODEL_URL).onEnabled(function (context, callback) {
    var enabled = context.dialogStack().length === 0;
    callback(null, enabled);
});
bot.recognizer(luisRecognizer);


bot.dialog('Help',
    (session, args, next) => {
        session.endDialog(`I'm the help desk bot and I can help you create a ticket or explore the knowledge base.\n` +
            `You can tell me things like _I need to reset my password_ or _explore hardware articles_.`);
    }
).triggerAction({
    matches: 'Help'
});

bot.dialog('SubmitTicket', [
    (session, args, next) => {
        var category = builder.EntityRecognizer.findEntity(args.intent.entities, 'category');
        var severity = builder.EntityRecognizer.findEntity(args.intent.entities, 'severity');

        if (category && category.resolution.values.length > 0) {
            session.dialogData.category = category.resolution.values[0];
        }

        if (severity && severity.resolution.values.length > 0) {
            session.dialogData.severity = severity.resolution.values[0];
        }

        session.dialogData.description = session.message.text;

        azureSearchQuery(`search=${encodeURIComponent(session.message.text)}`, (err, result) => {
            if (err || !result.value) return;
            var event = createEvent('searchResults', result.value, session.message.address);
            session.send(event);
        });

        if (!session.dialogData.severity) {
            var choices = ['high', 'normal', 'low'];
            builder.Prompts.choice(session, 'Which is the severity of this problem?', choices, { listStyle: builder.ListStyle.button });
        } else {
            next();
        }
    },
    (session, result, next) => {
        if (!session.dialogData.severity) {
            session.dialogData.severity = result.response.entity;
        }

        if (!session.dialogData.category) {
            builder.Prompts.text(session, 'Which would be the category for this ticket (software, hardware, networking, security or other)?');
        } else {
            next();
        }
    },
    (session, result, next) => {
        if (!session.dialogData.category) {
            session.dialogData.category = result.response;
        }

        var message = `Great! I'm going to create a "${session.dialogData.severity}" severity ticket in the "${session.dialogData.category}" category. ` +
            `The description I will use is "${session.dialogData.description}". Can you please confirm that this information is correct?`;

        builder.Prompts.confirm(session, message, { listStyle: builder.ListStyle.button });
    },
    (session, result, next) => {
        if (result.response) {
            var data = {
                category: session.dialogData.category,
                severity: session.dialogData.severity,
                description: session.dialogData.description,
            };
            session.sendTyping();

            const client = restifyClients.createJsonClient({ url: ticketSubmissionUrl });

            client.post('/api/tickets', data, (err, request, response, ticketId) => {
                if (err || ticketId == -1) {
                    session.send('Ooops! Something went wrong while I was saving your ticket. Please try again later.');
                } else {
                    session.send(new builder.Message(session).addAttachment({
                        contentType: "application/vnd.microsoft.card.adaptive",
                        content: createCard(ticketId, data)
                    }));
                }

                session.replaceDialog('UserFeedbackRequest');
            });
        } else {
            session.endDialog('Ok. The ticket was not created. You can start again if you want.');
        }
    }
]).triggerAction({
    matches: 'SubmitTicket'
}).cancelAction('cancelAction', 'Ok, I have canceled your request!', {
    matches: /^nevermind$|^cancel$|^cancel./i,
    confirmPrompt: "This will cancel your current request. Are you sure?"
});

//Create Backchannel Event
const createEvent = (eventName, value, address) => {
    var msg = new builder.Message().address(address);
    msg.data.type = 'event';
    msg.data.name = eventName;
    msg.data.value = value;
    return msg;
};

bot.on(`event`, function (event) {
    var msg = new builder.Message().address(event.address);
    msg.data.textLocale = 'en-us';
    if (event.name === 'showDetailsOf') {
        azureSearchQuery('$filter=' + encodeURIComponent(`title eq '${event.value}'`), (error, result) => {
            if (error || !result.value[0]) {
                msg.data.text = 'Sorry, I could not find that article.';
            } else {
                msg.data.text = result.value[0].text;
            }
            bot.send(msg);
        });
    }
});

bot.dialog('ExploreKnowledgeBase', [
    (session, args, next) => {
        var category = builder.EntityRecognizer.findEntity(args.intent.entities, 'category');

        if (!category) {
            // retrieve facets
            azureSearchQuery('facet=category', (error, result) => {
                if (error) {
                    session.endDialog('Ooops! Something went wrong while contacting Azure Search. Please try again later.');
                } else {
                    var choices = result['@search.facets'].category.map(item => `${item.value} (${item.count})`);
                    builder.Prompts.choice(session, 'Let\'s see if I can find something in the knowledge base for you. Which category is your question about?', choices, { listStyle: builder.ListStyle.button });
                }
            });
        } else {
            if (!session.dialogData.category) {
                session.dialogData.category = category.entity;
            }

            next();
        }
    },
    (session, args) => {
        var category;
        session.sendTyping();

        if (session.dialogData.category) {
            category = session.dialogData.category;
        } else {
            category = args.response.entity.replace(/\s\([^)]*\)/, '');
        }

        // search by category
        azureSearchQuery('$filter=' + encodeURIComponent(`category eq '${category}'`), (error, result) => {
            if (error) {
                session.endDialog('Ooops! Something went wrong while contacting Azure Search. Please try again later.');
            } else {
                session.replaceDialog('ShowKBResults', { result, originalText: category });
            }
        });
    }
]).triggerAction({
    matches: 'ExploreKnowledgeBase'
});


bot.dialog('SearchKB', [
    (session) => {
        session.sendTyping();
        azureSearchQuery(`search=${encodeURIComponent(session.message.text.substring('search about '.length))}`, (err, result) => {
            if (err) {
                session.send('Ooops! Something went wrong while contacting Azure Search. Please try again later.');
                return;
            }
            session.replaceDialog('ShowKBResults', { result, originalText: session.message.text });
        });
    }
])
    .triggerAction({
        matches: /^search about (.*)/i
    });

bot.dialog('DetailsOf', [
    (session, args) => {
        var title = session.message.text.substring('show me the article '.length);
        azureSearchQuery('$filter=' + encodeURIComponent(`title eq '${title}'`), (error, result) => {
            if (error || !result.value[0]) {
                session.endDialog('Sorry, I could not find that article.');
            } else {
                session.endDialog(result.value[0].text);
            }
        });
    }
]).triggerAction({
    matches: /^show me the article (.*)/i
});

bot.dialog('ShowKBResults', [
    (session, args) => {
        session.sendTyping();
        if (args.result.value.length > 0) {
            var msg = new builder.Message(session).attachmentLayout(builder.AttachmentLayout.carousel);
            args.result.value.forEach((faq, i) => {
                msg.addAttachment(
                    new builder.ThumbnailCard(session)
                        .title(faq.title)
                        .subtitle(`Category: ${faq.category} | Search Score: ${faq['@search.score']}`)
                        .text(faq.text.substring(0, Math.min(faq.text.length, 50) + '...'))
                        .images([builder.CardImage.create(session, 'https://raw.githubusercontent.com/GeekTrainer/help-desk-bot-lab/master/assets/botimages/head-smiling-medium.png')])
                        .buttons([{ title: 'More details', value: `show me the article ${faq.title}`, type: 'postBack' }])
                );
            });
            session.send(`These are some articles I\'ve found in the knowledge base for _'${args.originalText}'_, click **More details** to read the full article:`);
            session.endDialog(msg);
        } else {
            session.endDialog(`Sorry, I could not find any results in the knowledge base for _'${args.originalText}'_`);
        }
    }
]);

bot.dialog('UserFeedbackRequest', [
    (session, args) => {
        builder.Prompts.text(session, 'Can you please give me feedback about this experience?');
    },
    (session, args) => {
        const answer = session.message.text;
        analyzeText(answer, (err, score) => {
            if (err) {
                session.endDialog('Ooops! Something went wrong while analyzing your answer. An IT representative agent will get in touch with you to follow up soon.');
            } else {
                var msg = new builder.Message(session);

                var cardImageUrl, cardText;
                if (score < 0.5) {
                    cardText = 'I understand that you might be dissatisfied with my assistance. An IT representative will get in touch with you soon to help you.';
                    cardImageUrl = 'https://raw.githubusercontent.com/sGambolati/VuforiaImageRecognition/master/Assets/head-sad-small.png';
                } else {
                    cardText = 'Thanks for sharing your experience.';
                    cardImageUrl = 'https://raw.githubusercontent.com/sGambolati/VuforiaImageRecognition/master/Assets/head-smiling-extra-small.png';
                }
                msg.addAttachment(
                    new builder.HeroCard(session)
                        .text(cardText)
                        .images([builder.CardImage.create(session, cardImageUrl)])
                );

                if (score < 0.5) {
                    session.send(msg);
                    builder.Prompts.confirm(session, 'Do you want me to escalate this with an IT representative?');
                } else {
                    session.endDialog(msg);
                }
            }
        });
    },
    (session, args) => {
        if (args.response) {
            session.replaceDialog('HandOff');
        } else {
            session.endDialog();
        }
    }
]);

bot.on('conversationUpdate', function (message) {
    if (message.membersAdded) {
        message.membersAdded.forEach((identity) => {
            if (identity.id === message.address.bot.id) {
                var name = message.user ? message.user.name : null;
                var reply = new builder.Message()
                    .address(message.address)
                    .text("Hello %s, `I'm the help desk bot and I can help you create a ticket or explore the knowledge base.\n" +
            "You can tell me things like _I need to reset my password_ or _explore hardware articles_.", name || 'there');
                bot.send(reply);
            }

        })
    }
});

bot.on('contactRelationUpdate', function (message) {
    if (message.action === 'add') {
        var name = message.user ? message.user.name : null;
        var reply = new builder.Message()
            .address(message.address)
            .text("Hello %s... Thanks for adding me.", name || 'there');
        bot.send(reply);
    }
});

const createCard = (ticketId, data) => {
    var cardTxt = fs.readFileSync('./cards/ticket.json', 'UTF-8');

    cardTxt = cardTxt.replace(/{ticketId}/g, ticketId)
        .replace(/{severity}/g, data.severity)
        .replace(/{category}/g, data.category)
        .replace(/{description}/g, data.description);

    return JSON.parse(cardTxt);
};

//Hand-off
const HandOffRouter = require('./handoff/router');
const HandOffCommand = require('./handoff/command');

const handOffRouter = new HandOffRouter(bot, (session) => {
    return session.conversationData.isAgent;
});
const handOffCommand = new HandOffCommand(handOffRouter);

bot.use(handOffCommand.middleware());
bot.use(handOffRouter.middleware());

bot.dialog('AgentMenu', [
    (session, args) => {
        session.conversationData.isAgent = true;
        session.endDialog(`Welcome back human agent, there are ${handOffRouter.pending()} users waiting in the queue.\n\nType _agent help_ for more details.`);
    }
]).triggerAction({
    matches: /^\/agent login/
});

bot.dialog('HandOff',
    (session, args, next) => {
        if (handOffCommand.queueMe(session)) {
            var waitingPeople = handOffRouter.pending() > 1 ? `, there are ${handOffRouter.pending() - 1} users waiting` : '';
            session.send(`Connecting you to the next available human agent... please wait${waitingPeople}.`);
        }
        session.endDialog();
    }
).triggerAction({
    matches: 'HandOffToHuman'
});