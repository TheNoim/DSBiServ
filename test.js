/**
 * Created by nilsbergmann on 16.01.17.
 */
const DSBLibrary = require('./dsblib');
const dsb = new DSBLibrary(require('./config.json').host, require('./config.json').username, require('./config.json').password, `./cookie_cache.json`, true);

