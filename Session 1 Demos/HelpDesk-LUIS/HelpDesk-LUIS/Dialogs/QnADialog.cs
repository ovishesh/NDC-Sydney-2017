using Microsoft.Bot.Builder.CognitiveServices.QnAMaker;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace HelpDesk_LUIS.Dialogs
{
    [Serializable]
    [QnAMaker("{Key}", "{KB Id}", "Sorry we could not find your answer in our knowledgebase.", 0.4, 1)]
    public class QnADialog : QnAMakerDialog
    {
    }
}