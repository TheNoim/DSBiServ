# DSB iServ Library
This Library tries to help you receiving dsb plans from iServ.  

#### What do I need ?
* A school with iServ (v3 required)
* The "Plan" module need's to be installed in iServ
* The school needs to use the DSB Software with Untis

#### How does it work ?
The module tries to login with your iServ credentials and extracts the iframes out of iserv.  
The difficulty behind this is, the DSB consist of many many iframes and js hrefs.  
After the module got the last html page with the final plan, it will parse it into json.

#### How can I use it ?

```javascript
const DSBLib = require('dsbiserv');
const dsb = new DSBLib('myschool.de', 'max.mustermann', 'mypassword', 'A path to a cookie session cache (OPTIONAL)', true /*DEBUG OUTPUT YES OR NO*/, 'iserv/plan/show/raw/DSB%20Schueler');

// Now you have two options. Only get the html of the plan or get it parsed as json

// Only get the html:
dsb.getDSBPlans((error, Plans) => {
    console.log(Plans); // Plans is a array with every Plan as string
});

// Get parsed:

dsb.getParsed((error, Plans) => {
    // Plans: Array with objects
    // Object looks like this:
    // {
    //  "date": "20.1.2017" // For which day the plan is
    //  "plan": [
    //      {
    //       "Klasse(n)": "10ABCD11127ABCMZ8ABLCD9ABMNMZAG",
    //       "Std.": "7-8",
    //       "Fach": "AG",
    //       "Lehrer": "Lehrer",
    //       "statt": "Lehrer",
    //       "Raum": null,
    //       "Bemerkungen": null,
    //       "Entfall": true,
    //       "Stunden": [
    //         7,
    //         8
    //       ],
    //       "KlassenStufen": [
    //         10,
    //         7,
    //         ...
    //       ],
    //       "KlassenBuchstaben": [
    //         "A",
    //         "B",
    //         ...
    //       ],
    //       "Klassen": [
    //         "10A",
    //         "10B",
    //         ...
    //       ],
    //       "GanzerJahrgang": false
    //      }
    //  ],
    //  "html": "html string"
    // }
});

// Or parse it by yourself:
dsb.parsePlan(HTML, (error, Parse) => {
    // You know...
});

```
