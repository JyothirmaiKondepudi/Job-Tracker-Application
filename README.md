# Job-Tracker-Application

A Google Apps Script project bound to a Google Sheet named Job Tracker that automatically tracks job application statuses and logs details.

**Setup**

1. Create or open a Google Sheet, and rename the tab (sheet) to Job Tracker.

2. In the Google Sheet menu, go to Extensions > Apps Script.

3. In the Apps Script editor:

    1. If prompted, set a Project name (e.g., Job Tracker Script).
    2. Delete any default boilerplate code in Code.gs.

4. Paste your tracking script into the editor.

5. Click Save or press Ctrl+S.

Return to your sheet and refresh to ensure the script is bound.

**Configuration**

1. If your script references the sheet by name or ID, verify that the constants match:

    const SHEET_NAME = 'Job Tracker';
    const SHEET_ID   = SpreadsheetApp.getActive().getId();

2. On first run, you will be prompted to authorize required scopes (e.g., reading/writing sheets, accessing Gmail).

**Deployment**

1. In the Apps Script editor, click Deploy > New deployment.

2. Select the appropriate deployment type:

    1. Web app (if you need an HTTP endpoint)
    
    2. API executable
    
    3. Library (to include in other scripts)

3. Under Execute as, choose Me.

4. Under Who has access, select your desired audience (e.g., Only myself).

5. Click Deploy, then Authorize when prompted.

**Usage**

- Manual run: Open Apps Script editor, choose function (e.g. trackJobs) from the dropdown, and click Run.

- Automated triggers:

    1. In the Apps Script editor, click the Triggers (clock) icon.
    
    2. Click Add Trigger.
    
    3. Select the function to run, choose Time-driven, then configure frequency (e.g., daily at 9 AM).
    
    4. Save the trigger.

- View logs: In editor, go to Executions or View > Logs to monitor runs and debug errors.

**Sample Output**

<img width="1457" height="730" alt="image" src="https://github.com/user-attachments/assets/0565377e-7fdd-4cef-af1e-c52c888fd328" />
