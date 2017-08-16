using Microsoft.Bot.Builder.Dialogs;
using Microsoft.Bot.Builder.Luis;
using Microsoft.Bot.Builder.Luis.Models;
using Microsoft.Bot.Connector;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Web;

namespace HelpDesk_LUIS.Dialogs
{
    [Serializable]
    [LuisModel("{Luis App Id}", "{Key}")]
    public class LuisDialog : LuisDialog<object>
    {

        [LuisIntent("")]
        [LuisIntent("None")]
        public async Task None(IDialogContext context, IAwaitable<IMessageActivity> message, LuisResult result)
        {
            await context.PostAsync($"I'm sorry, I did not understand {result.Query}.\nType 'help' to know more about me :)");

            await context.PostAsync("Hi there! Searching knowledge base for your question. Please wait...");

            var qnadialog = new QnADialog();
            var messageToForward = await message;

            await context.Forward(qnadialog, AfterQnADialog, messageToForward, CancellationToken.None);
        }
        private async Task AfterQnADialog(IDialogContext context, IAwaitable<IMessageActivity> result)
        {
            context.Done("");
        }

        [LuisIntent("Help")]
        public async Task Help(IDialogContext context, LuisResult result)
        {
            await context.PostAsync("I'm the help desk bot and I can help you create a ticket.\n" +
                                    "You can tell me things like _I need to reset my password_ or _I cannot print_.");
            context.Done<object>(null);
        }

        [LuisIntent("SubmitTicket")]
        public async Task SubmitTicket(IDialogContext context, LuisResult result)
        {
            await context.PostAsync("Thanks for the issue, but my dev is being lazy to code anything");
        }
    }
}