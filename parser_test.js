/**
 * Created by nilsbergmann on 17.01.17.
 */
const DSBLibrary = require('./dsb');
const dsb = new DSBLibrary(require('./config.json').host, require('./config.json').username, require('./config.json').password, `./cookie_cache.json`, true);
const fs = require('fs');
dsb.getParsed((error, Plans) => {
    console.error(error);
    fs.writeFileSync('./test.json', JSON.stringify(Plans));
});