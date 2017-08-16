const builder = require('botbuilder');
const { Provider, ConversationState } = require('./provider');

function Router(bot, isAgent) {
    'use strict';

    const provider = new Provider();


    const middleware = () => {
        return {
            botbuilder: (session, next) => {
                if (session.message.type === 'message') {
                    if (isAgent(session)) {
                        routeAgentMessage(session);
                    } else {
                        routeUserMessage(session, next);
                    }
                } else {
                    next();
                }
            }
        };
    };


    const routeAgentMessage = (session) => {
        const message = session.message;
        const conversation = provider.findByAgentId(message.address.conversation.id);

        if (!conversation) {
            return;
        }

        bot.send(new builder.Message().address(conversation.user).text(message.text));
    };

    const routeUserMessage = (session, next) => {
        const message = session.message;

        const conversation = provider.findByConversationId(message.address.conversation.id) || provider.createConversation(message.address);

        switch (conversation.state) {
            case ConversationState.ConnectedToBot:
                return next();
            case ConversationState.WaitingForAgent:
                session.send(`Connecting you to the next available human agent... please wait, there are ${pending() - 1} users waiting.`);
                return;
            case ConversationState.ConnectedToAgent:
                bot.send(new builder.Message().address(conversation.agent).text(message.text));
                return;
        }
    };

    const pending = () => {
        return provider.currentConversations().filter((conv) => conv.state === ConversationState.WaitingForAgent).length;
    };

    return {
        isAgent,
        middleware,
        pending,
        provider,
        bot
    };
}

module.exports = Router;
