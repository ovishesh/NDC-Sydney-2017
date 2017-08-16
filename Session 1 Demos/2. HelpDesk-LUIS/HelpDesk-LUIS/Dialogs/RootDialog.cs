using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Bot.Builder.Dialogs;
using System.Threading;
using Microsoft.Bot.Connector;

namespace HelpDesk_LUIS.Dialogs
{

    [Serializable]
    public class RootDialog : IDialog<object>
    {
        public Task StartAsync(IDialogContext context)
        {
            context.Wait(MessageReceivedAsync);

            return Task.CompletedTask;
        }

        private async Task MessageReceivedAsync(IDialogContext context, IAwaitable<object> result)
        {
            var activity = await result as Activity;

            await context.Forward(new LuisDialog(), ResumeAfterLuisDialog, activity, CancellationToken.None);
        }

        private async Task ResumeAfterLuisDialog(IDialogContext context, IAwaitable<object> result)
        {
            context.Done("");
        }
    }
}