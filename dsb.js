/**
 * Created by nilsbergmann on 16.01.17.
 */

const request = require('request');
const fs = require('fs');
const cheerio = require('cheerio');
const _ = require('lodash');
const async = require('async');

class DSBLibrary {

    /**
     *
     * @param {string} iServHost
     * @param {string} iServUsername
     * @param {string} iServPassword
     * @param {string} CookieFile - Path to file with cookies (iServ login cookie cache)
     * @param {boolean} [debugOutput]
     */
    constructor(iServHost, iServUsername, iServPassword, CookieFile ,debugOutput){
        this.host = iServHost;
        this.username = iServUsername;
        this.password = iServPassword;
        this.debug = debugOutput ? debugOutput : false;
        this.log = function (message) {
            if (this.debug){
                console.log(message);
            }
        };
        this.cookies = null;
        this.cookie_cache = CookieFile ? CookieFile : null;
        try {
            this.cookies = require(CookieFile);
        } catch (e) {
            this.cookies = null;
        }
    }

    getDSBPlans(DSBCallback){
        async.waterfall([
            (WaterfallCallback) => {
                if (this.cookies){
                    this._checkCookies((error) => {
                        if (error){
                            this._login(WaterfallCallback);
                        } else {
                            WaterfallCallback();
                        }
                    });
                } else {
                    this._login(WaterfallCallback);
                }
            },
            (WaterfallCallback) => this._DoRequest(`https://${this.host}/iserv/plan/show/raw/DSB%20Schueler`, null, false, WaterfallCallback),
            (HTML, WaterfallCallback) => WaterfallCallback(null, this._FastIFrameParse(HTML, 'iframe[name="DSBHPLehrer"]')),
            (URL, WaterfallCallback) => this._DoRequest(URL, null, true, WaterfallCallback),
            (HTML, URLReferer, WaterfallCallback) => WaterfallCallback(null, this._FastIFrameParse(HTML, 'iframe'), URLReferer),
            (URL, URLReferer, WaterfallCallback) => this._DoRequest(URL, URLReferer, false, WaterfallCallback),
            (HTML, WaterfallCallback) => {
                /**
                 * Now lets get both plans: Vertretungsplan-Modul, Vertretungsplan-Modul 2
                 */
                let Plans = [];
                async.each(this._FastIFrameParse(HTML, ['iframe[name="Vertretungsplan-Modul"]','iframe[name="Vertretungsplan-Modul 2"]']), (IFrame, EachCallback) => {
                    const URL = IFrame.src;
                    if (URL){
                        this._DoRequest(URL, null, true, (error, HTML, Referer) => {
                            if (error) {
                                EachCallback(error);
                            } else {
                                const PlanURL = this._GetThisShittyJSLocationHref(HTML);
                                this._DoRequest(PlanURL, Referer, false, (error, HTML) => {
                                    this._DoRequest(this._FastIFrameParse(HTML, 'iframe'), PlanURL, false, (error, HTML) => {
                                        if (error){
                                            EachCallback(error);
                                        } else {
                                            Plans.push(HTML);
                                            EachCallback();
                                        }
                                    });
                                });
                            }
                        });
                    } else {
                        EachCallback();
                    }

                }, (error) => {
                    WaterfallCallback(error, Plans);
                });
            }
        ], (error, Plans) => {
            if (error) this.log(error);
            DSBCallback(error, Plans);
        });
    }

    /**
     * Login into iServ
     * @param LoginCallback
     * @private
     */
    _login(LoginCallback){
        this.log(`[DEBUG] Start login process.`);
        /**
         * Send login request
         */
        request.post(`https://${this.host}/iserv/login_check`, {
            form: {
                _username: this.username,
                _password: this.password
            }
        }, (error, response) => {
            if (!error && response.statusCode == 302) {
                if (response.headers["set-cookie"]){
                    let cookies = {};
                    /**
                     * Parse the 'set-cookie' to a use able format.
                     */
                    for (let u in response.headers["set-cookie"]){
                        if (response.headers["set-cookie"].hasOwnProperty(u)){
                            const current = response.headers["set-cookie"][u];
                            const m = /^[^;]+/.exec(current);
                            if (m){
                                const CookieSplit = m[0].split("=");
                                if (CookieSplit[0] && CookieSplit[1]){
                                    cookies[CookieSplit[0]] = CookieSplit[1];
                                }
                            }
                        }
                    }
                    this.cookies = cookies;
                    this._makeCookieHeaderString();
                    this.log(`[DEBUG] Login successfully with user ${this.username}!`);
                    if (this.cookie_cache){
                        fs.writeFile(this.cookie_cache, JSON.stringify(this.cookies), LoginCallback);
                    } else {
                        LoginCallback();
                    }
                } else {
                    /**
                     * With the header 'set-cookie' sets iServ the login sessions. If there is no header 'set-cookie' this error appears.
                     */
                    LoginCallback(`No 'set-cookie' found. Login not successfully ?`);
                }
            } else {
                /**
                 * The response status code needs to be 302 if not this error appears.
                 */
                LoginCallback(`Something went wrong. Response code: ${response.statusCode} | Error: ${error}`);
            }
        });
    }

    /**
     * Checks if the cookies are still valid
     * @param CookieCallback
     * @private
     */
    _checkCookies(CookieCallback){
        this.log(`[DEBUG] Check if your cookies are still valid.`);
        if (this.cookies){
            /**
             * Header cookie string from cookies.
             * @type {string}
             */
            this._makeCookieHeaderString();
            request(`https://${this.host}/iserv/login_check`, {
                headers: {
                    Cookie: this.cookieHeader
                },
                followRedirect: false
            },(error, response, body) => {
                if (!error && response.statusCode == 200) {
                    CookieCallback();
                } else {
                    CookieCallback(`It seems that your cookies are no longer valid! Response status code ${response.statusCode} | Error ${error}`);
                }
            });
        } else {
            CookieCallback(`Where are my cookies !!?? This should never happen!`);
        }
    }

    /**
     * Make cookie header string
     * @private
     */
    _makeCookieHeaderString(){
        let cookieString = "";
        for (let CookieIndex in this.cookies){
            if (this.cookies.hasOwnProperty(CookieIndex)) {
                cookieString = cookieString + `${CookieIndex}=${this.cookies[CookieIndex]}; `;
            }
        }
        this.cookieHeader = cookieString;
    }

    /**
     * Fast parse the html and get the src of a iFrame with given selector
     * @param HTML
     * @param {Array|string} Selector
     * @returns {Array|jQuery}
     * @private
     */
    _FastIFrameParse(HTML, Selectors){
        const $ = cheerio.load(HTML);
        if (_.isArray(Selectors)){
            let returnArray = [];
            for (let index in Selectors){
                if (Selectors.hasOwnProperty(index)){
                    returnArray.push({
                        selector: Selectors[index],
                        src: $(Selectors[index]).attr('src')
                    });
                }
            }
            return returnArray;
        } else {
            return $(Selectors).attr('src');
        }

    }

    /**
     * Fast do a request and handel errors
     * @param URL
     * @param Referer - The on going url to fake a iFrame request
     * @param WithURL
     * @param RequestCallback
     * @private
     */
    _DoRequest(URL, Referer, WithURL, RequestCallback){
        let options = {
            headers: {
                Cookie: this.cookieHeader
            }
        };
        if (Referer){
            options.headers.Referer = Referer;
        }
        this.log(`[DEBUG] Do request to ${URL} with this options: ${JSON.stringify(options)}`);
        request(URL, options, (error, response, body) => {
            if (!error && response.statusCode == 200){
                this.log(`[DEBUG] Successfully!`);
                if (WithURL){
                    RequestCallback(null, body, URL);
                } else {
                    RequestCallback(null, body);
                }

            } else {
                RequestCallback(`Hmm. Something happened. Maybe you know what to do with this status code ${response.statusCode} and this error ${error}`);
            }
        });
    }

    /**
     * Parse the html and fast get this shitty location.href url
     * @param HTML
     * @returns {XML|*|void|String|string}
     * @private
     */
    _GetThisShittyJSLocationHref(HTML) {
        const superRegex = /location.href=".+(?=";)/;
        const m = superRegex.exec(HTML);
        return m[0].replace('location.href="', '');
    }

}

module.exports = DSBLibrary;