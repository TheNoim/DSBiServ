/**
 * Created by nilsbergmann on 26.01.17.
 */
const DSBLibrary = require('./dsb');
const dsb = new DSBLibrary(require('./config.json').host, require('./config.json').username, require('./config.json').password, `./cookie_cache.json`, false);
const fs = require('fs');
const jsome = require('jsome');
fs.readFile(`BUGU.html`, (error, data) => {
    if (error) throw error; // too lazy
    console.log(data);
    dsb.parsePlan(data.toString(), (error, Plans) => {
        if (error) throw error;
        for (Index in Plans){
            if (!Plans.hasOwnProperty(Index)) continue;
            Plans[Index].html = null;
        }
        console.log(JSON.stringify(Plans));
        debugger;
    });
});