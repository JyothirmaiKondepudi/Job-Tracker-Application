/**
 * CONFIGURATION
 */
const OPENAI_API_KEY  = PropertiesService.getScriptProperties()
  .getProperty('OPENAI_API_KEY');
const SHEET_ID        = 'YOUR_REAL_SHEET_ID_HERE';
const SHEET_NAME      = 'Job Applications';
const PROCESSED_LABEL = 'Job_Processed';

/**
 * ENTRY POINT — process today’s inbox threads
 */
function processJobEmails() {
  const labelProcessed = getOrCreateLabel(PROCESSED_LABEL);

  // build “today” / “tomorrow” for Gmail search
  const today   = new Date("06-20-2025");
  const yyyy    = today.getFullYear();
  const mm      = String(today.getMonth()+1).padStart(2,'0');
  const dd      = String(today.getDate()).padStart(2,'0');
  const after   = `${yyyy}/${mm}/${dd}`;
  const tomo    = new Date(today);
  tomo.setDate(tomo.getDate()+1);
  const yyyy2   = tomo.getFullYear();
  const mm2     = String(tomo.getMonth()+1).padStart(2,'0');
  const dd2     = String(tomo.getDate()).padStart(2,'0');
  const before  = `${yyyy2}/${mm2}/${dd2}`;

  const QUERY = [
    'in:inbox',
    `after:${after}`,
    `before:${before}`,
    `-label:${PROCESSED_LABEL}`
  ].join(' ');

  let processedCount = 0;
  const BATCH = 500, CHUNK = 100;
  for (let start=0; start<BATCH; start+=CHUNK) {
    const threads = GmailApp.search(QUERY, start, CHUNK);
    if (!threads.length) break;

    threads.forEach(thread => {
      try {
        const messages = thread.getMessages().reverse();
        let done = false;

        for (let msg of messages) {
          if (done) break;
          const subj = msg.getSubject();
          const body = msg.getPlainBody() || msg.getBody().replace(/<[^>]+>/g,'\n');
          const analysis = analyzeEmailWithOpenAI(subj, body);
          
          Logger.log(msg.getDate())
          // new guard — allow either job_application OR job_update boolean
          if (
            !analysis ||
            (typeof analysis.job_application !== 'boolean' &&
            typeof analysis.job_update  !== 'boolean')
          ) {
            Logger.log('⚠️ Invalid AI output, skipping');
            continue;
          }

          Logger.log("analysis:")
          Logger.log(analysis)
          if (analysis.job_application) {
            recordNewApplication(
              analysis.company_name,
              analysis.job_title,
              analysis.application_url,
              msg.getDate()
            );
            thread.addLabel(getOrCreateLabel('Job_Postings'));
            done = true;
          }
          else if (analysis.job_update) {
            // normalize status to one of our keywords
            let s = String(analysis.status||'').toLowerCase();
            if (/regret|unfortunately|sorry/.test(s))  {    
               analysis.status='Rejected';
            
            }
            else if (/interview/.test(s))      
                 analysis.status='Interview';
            else if (/offer/.test(s))                       
                analysis.status='Offer';
            else if (/withdraw/.test(s))                    
                analysis.status='Withdrawn';
            else                                            
                analysis.status='Rejected';

            Logger.log("calling update row function here")
            updateApplicationStatus(
              analysis.company_name,
              analysis.job_title,
              analysis.status
            );
            thread.addLabel(getOrCreateLabel('Job_Updates'));
            done = true;
          }
        }

        thread.addLabel(labelProcessed);
        thread.getMessages().pop().markRead();
        processedCount++;
      }
      catch(e) {
        Logger.log('ERROR on thread: '+e);
      }
    });

    if (threads.length<CHUNK) break;
  }
  

  Logger.log(`✅ ${processedCount} threads processed.`);
}


/**
 * ANALYZE WITH OPENAI
 */
function analyzeEmailWithOpenAI(subject, body) {
  const MAX = 14000;
  const txt = body.length>MAX
    ? body.slice(0,MAX)+'\n\n...[truncated]'
    : body;

  const systemPrompt = `
You are an assistant that reads an email subject and body and must classify it as one of:
  • A genuine application confirmation (e.g. “Thank you for applying”, “we have received your application”)
  • A status update, including rejections or interview invites (e.g. “we regret to inform you”, “interview scheduled”)
  • Or purely a job-posting/alert (e.g. “new jobs matching your profile”, “This job is a match”, “daily digest”)

If it’s a confirmation, reply ONLY with:
{
  "job_application": true,
  "company_name": "<company name>",
  "job_title": "<position title>",
  "application_date": "<ISO8601 date>",
  "application_url": "<posting URL>"
}

If it’s a status update (including rejections or interview invites), reply ONLY with exactly this JSON, choosing one of:
  • "Interview"
  • "Rejected"
  • "Offer"
  • "Withdrawn"

{
  "job_update": true,
  "company_name": "<company name>",
  "job_title": "<position title>",
  "status": "<one of: Interview, Rejected, Offer, Withdrawn>"
}

If it’s purely a job-posting or alert, or anything else, reply:
{ "job_application": false, "job_update": false }
`.trim();

  const payload = {
    model: 'gpt-3.5-turbo',
    temperature: 0,
    messages: [
      { role:'system', content: systemPrompt },
      { role:'user',   content: `Subject:\n${subject}\n\nBody:\n${txt}` }
    ]
  };

  let aiText='';
  try {
    const res = UrlFetchApp.fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method:'post',
        contentType:'application/json',
        headers:{ Authorization:`Bearer ${OPENAI_API_KEY}` },
        payload:JSON.stringify(payload)
      }
    );
    
    Logger.log(res)
    
    const j = JSON.parse(res.getContentText());
    aiText = j.choices?.[0]?.message?.content||'';
  } catch(e) {
    Logger.log('OpenAI error: '+e);
  }

  const out = parseJSONFromAI(aiText);
  
  return (out
    && (typeof out.job_application === 'boolean'
        || typeof out.job_update === 'boolean'))
  ? out
  : { job_application: false, job_update: false };

}

function parseJSONFromAI(text) {
  let t = (text||'').trim()
    .replace(/^```(?:json)?\s*/i,'')
    .replace(/\s*```$/i,'');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a!==-1 && b!==-1) t = t.slice(a,b+1);
  try {
    return JSON.parse(t);
  } catch(e) {
    Logger.log('JSON parse error: "'+t+'"');
    return { job_application:false, job_update:false };
  }
}


/**
 * RECORD / UPDATE
 */
function recordNewApplication(company, title, url, dateObj) {
  const sheet = getSheet();
  const dt = dateObj instanceof Date ? dateObj : new Date();
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth()+1).padStart(2,'0');
  const d  = String(dt.getDate()).padStart(2,'0');
  const dateOnly = `${y}-${m}-${d}`;
  Logger.log(dateObj+" "+dateOnly)
  sheet.appendRow([
    company,    // A
    title,      // B
    url,        // C
    'Applied',  // D
    dateOnly,   // E
    new Date().toISOString() // F
  ]);
}

function updateApplicationStatus(company, title, status) {
  const sheet = getSheet(), rows = sheet.getDataRange().getValues();
  for (let i=1; i<rows.length; i++) {
    if (rows[i][0]===company && rows[i][1]===title) {
      const x = sheet.getRange(i+1,4).setValue(status);
      const y = sheet.getRange(i+1,6).setValue(new Date().toISOString());
      Logger.log(x,y)
      return;
    }
  }
  Logger.log(`No row for update: ${company}/${title}`);
}

/**
 * HELPERS
 */
function getSheet() {
  return SHEET_ID&&SHEET_ID!=='YOUR_REAL_SHEET_ID_HERE'
    ? SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME)
    : SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}
function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
