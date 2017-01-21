/**
 * Created by nilsbergmann on 17.01.17.
 */
const DSBLibrary = require('./dsb');
const clui = require('clui');
const dsb = new DSBLibrary(require('./config.json').host, require('./config.json').username, require('./config.json').password, `./cookie_cache.json`, false);
const fs = require('fs');
const Jetty = require("jetty");
const jetty = new Jetty(process.stdout);
jetty.clear();

dsb.getParsed((error, Plans) => {
    //console.error(error);
    fs.writeFileSync('./test.json', JSON.stringify(Plans));
});

const Progress = clui.Progress;

const thisProgressBar = new Progress(20);

dsb.Events.on('progress', (Max, Progress) => {
    jetty.moveTo([0,0]);
    console.log(thisProgressBar.update(Progress, Max));
});
