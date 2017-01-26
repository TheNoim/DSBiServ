/**
 * Created by nilsbergmann on 16.01.17.
 */

const request = require('request');
const fs = require('fs');
const cheerio = require('cheerio');
const _ = require('lodash');
const async = require('async');
const tabletojson = require('tabletojson');
const rangeParser = require('parse-numeric-range');
const iconv = require('iconv-lite');
const EventEmitter = require("events").EventEmitter;
const WatchJS = require('watchjs');

class DSBLibrary {

    /**
     *
     * @param {string} iServHost
     * @param {string} iServUsername
     * @param {string} iServPassword
     * @param {string} CookieFile - Path to file with cookies (iServ login cookie cache)
     * @param {boolean} [debugOutput]
     */
    constructor(iServHost, iServUsername, iServPassword, CookieFile, debugOutput) {
        this.host = iServHost;
        this.username = iServUsername;
        this.password = iServPassword;
        this.debug = debugOutput ? debugOutput : false;
        this.log = function (message) {
            if (this.debug) {
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
        this.Events = new EventEmitter();
        this.Progress = 0;
        WatchJS.watch(this, 'Progress', () => {
            this.Events.emit('progress', this.Max, this.Progress);
        });
    }

    /**
     * Download the dsb plans and get them parsed.
     * @param {function} DSBCallback
     */
    getParsed(DSBCallback) {
        this.Progress = 0;
        this.Max = 11;
        this.getDSBPlans((error, Plans) => {
            if (error) {
                DSBCallback(error);
            } else {
                let ResultPlans = [];
                async.each(Plans, (Plan, EachCallback) => {
                    this.parsePlan(Plan.html, (error, BPlan) => {
                        if (error) return EachCallback(error);
                        ResultPlans.push({
                            date: Plan.date,
                            plan: BPlan,
                            lastUpdate: DSBLibrary._getStatus(Plan.html),
                            html: Plan.html
                        });
                        EachCallback();
                    });
                }, (error) => {
                    this.Progress += this.Max - this.Progress;
                    DSBCallback(error, ResultPlans);
                });
            }
        });
    }

    getDSBPlans(DSBCallback) {
        async.waterfall([
            (WaterfallCallback) => {
                if (this.cookies) {
                    this._checkCookies((error) => {
                        if (error) {
                            this.log(`[DEBUG] ${error}`);
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
            (HTML, WaterfallCallback) => WaterfallCallback(null, DSBLibrary._FastIFrameParse(HTML, 'iframe[name="DSBHPLehrer"]')),
            (URL, WaterfallCallback) => this._DoRequest(URL, null, true, WaterfallCallback),
            (HTML, URLReferer, WaterfallCallback) => WaterfallCallback(null, DSBLibrary._FastIFrameParse(HTML, 'iframe'), URLReferer),
            (URL, URLReferer, WaterfallCallback) => this._DoRequest(URL, URLReferer, false, WaterfallCallback),
            (HTML, WaterfallCallback) => {
                /**
                 * Now lets get both plans: Vertretungsplan-Modul, Vertretungsplan-Modul 2
                 */
                let Plans = [];

                async.each(DSBLibrary._FastIFrameParse(HTML, ['iframe[name="Vertretungsplan-Modul"]', 'iframe[name="Vertretungsplan-Modul 2"]']), (IFrame, EachCallback) => {
                    const URL = IFrame.src;
                    if (URL) {
                        this._DoRequest(URL, null, true, (error, HTML, Referer) => {
                            if (error) {
                                EachCallback(error);
                            } else {
                                const PlanURL = DSBLibrary._GetThisShittyJSLocationHref(HTML);
                                this._DoRequest(PlanURL, Referer, false, (error, HTML) => {
                                    this._DoRequest(DSBLibrary._FastIFrameParse(HTML, 'iframe'), PlanURL, false, (error, HTML) => {
                                        if (error) {
                                            EachCallback(error);
                                        } else {
                                            const $ = cheerio.load(HTML);
                                            const MonTitle = $(".mon_title");
                                            const regexForDate = /^(?:(?:31(\/|-|\.)(?:0?[13578]|1[02]))\1|(?:(?:29|30)(\/|-|\.)(?:0?[1,3-9]|1[0-2])\2))(?:(?:1[6-9]|[2-9]\d)?\d{2})$|^(?:29(\/|-|\.)0?2\3(?:(?:(?:1[6-9]|[2-9]\d)?(?:0[48]|[2468][048]|[13579][26])|(?:(?:16|[2468][048]|[3579][26])00))))$|^(?:0?[1-9]|1\d|2[0-8])(\/|-|\.)(?:(?:0?[1-9])|(?:1[0-2]))\4(?:(?:1[6-9]|[2-9]\d)?\d{2})/;
                                            const date = regexForDate.exec(MonTitle.contents()[0].data)[0];
                                            Plans.push({
                                                date: date,
                                                html: HTML
                                            });
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
    _login(LoginCallback) {
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
                if (response.headers["set-cookie"]) {
                    let cookies = {};
                    /**
                     * Parse the 'set-cookie' to a use able format.
                     */
                    for (let u in response.headers["set-cookie"]) {
                        if (response.headers["set-cookie"].hasOwnProperty(u)) {
                            const current = response.headers["set-cookie"][u];
                            const m = /^[^;]+/.exec(current);
                            if (m) {
                                const CookieSplit = m[0].split("=");
                                if (CookieSplit[0] && CookieSplit[1]) {
                                    cookies[CookieSplit[0]] = CookieSplit[1];
                                }
                            }
                        }
                    }
                    this.cookies = cookies;
                    this._makeCookieHeaderString();
                    this.log(`[DEBUG] Login successfully with user ${this.username}!`);
                    if (this.cookie_cache) {
                        this.Progress += 1;
                        fs.writeFile(this.cookie_cache, JSON.stringify(this.cookies), LoginCallback);
                    } else {
                        this.Progress += 1;
                        LoginCallback();
                    }
                } else {
                    /**
                     * With the header 'set-cookie' sets iServ the login sessions. If there is no header 'set-cookie' this error appears.
                     */
                    LoginCallback(`No 'set-cookie' found. Login not successfully ?`);
                    this.Progress += 1;
                }
            } else {
                /**
                 * The response status code needs to be 302 if not this error appears.
                 */
                LoginCallback(`Something went wrong. Response code: ${response.statusCode} | Error: ${error}`);
                this.Progress += 1;
            }
        });
    }

    /**
     * Checks if the cookies are still valid
     * @param CookieCallback
     * @private
     */
    _checkCookies(CookieCallback) {
        this.log(`[DEBUG] Check if your cookies are still valid.`);
        if (this.cookies) {
            /**
             * Header cookie string from cookies.
             * @type {string}
             */
            this._makeCookieHeaderString();
            request(`https://${this.host}/iserv/user/api/notifications`, {
                headers: {
                    Cookie: this.cookieHeader
                },
                followRedirect: false
            }, (error, response, body) => {
                if (!error && response.statusCode == 200) {
                    this.Progress += 1;
                    CookieCallback();
                } else {
                    this.Progress += 1;
                    CookieCallback(`It seems that your cookies are no longer valid! Response status code ${response.statusCode} | Error ${error}`);
                }
            });
        } else {
            this.Progress += 1;
            CookieCallback(`Where are my cookies !!?? This should never happen!`);
        }
    }

    /**
     * Make cookie header string
     * @private
     */
    _makeCookieHeaderString() {
        let cookieString = "";
        for (let CookieIndex in this.cookies) {
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
    static _FastIFrameParse(HTML, Selectors) {
        const $ = cheerio.load(HTML);
        if (_.isArray(Selectors)) {
            let returnArray = [];
            for (let index in Selectors) {
                if (Selectors.hasOwnProperty(index)) {
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
    _DoRequest(URL, Referer, WithURL, RequestCallback) {
        let options = {
            headers: {
                Cookie: this.cookieHeader,
                "Accept-Encoding": "UTF-8",
                "Content-Type": "text/plain; charset=utf-8;",
            },
            encoding: null
        };
        if (Referer) {
            options.headers.Referer = Referer;
        }
        this.log(`[DEBUG] Do request to ${URL} with this options: ${JSON.stringify(options)}`);
        request(URL, options, (error, response, body) => {
            if (!error && response.statusCode == 200) {
                this.log(`[DEBUG] Successfully!`);
                if (WithURL) {
                    this.Progress += 1;
                    RequestCallback(null, iconv.decode(Buffer.from(body), 'cp1252'), URL);
                } else {
                    this.Progress += 1;
                    RequestCallback(null, iconv.decode(Buffer.from(body), 'cp1252'));
                }

            } else {
                this.Progress += 1;
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
    static _GetThisShittyJSLocationHref(HTML) {
        const superRegex = /location.href=".+(?=";)/;
        const m = superRegex.exec(HTML);
        return m[0].replace('location.href="', '');
    }

    /**
     * Parse the DSB Plan in a usable format
     * @param {String} HTMLPlan
     * @param {function} ParseCallback
     */
    parsePlan(HTMLPlan, ParseCallback) {
        //try {
            const $ = cheerio.load(HTMLPlan);
            const PlanTableHTML = $('table[class="mon_list"]').parent().html();
            const TableJson = tabletojson.convert(PlanTableHTML);
            if (TableJson.length == 1) {
                this.Progress += 1;
                ParseCallback(null, DSBLibrary._reformatPlanJSON(TableJson[0]));
            } else {
                this.Progress += 1;
                ParseCallback(`Something went wrong. Maybe they changed the format ?`);
            }
        //} catch (e) {
        //    this.Progress += 1;
        //    return ParseCallback(`Something went wrong. Maybe you should check out this error: ${e}`);
        //}
    }

    /**
     * Reformat the plan json
     * @param {JSON} JSON
     * @returns {JSON}
     * @private
     */
    static _reformatPlanJSON(JSON) {
        const Plan = JSON;
        let needToRemove = [];
        for (let PlanIndex in Plan) {
            if (Plan.hasOwnProperty(PlanIndex)) {
                if (needToRemove.indexOf(PlanIndex) != -1) continue;
                let LinesToAdd = [];
                for (let TestForMultiLinesIndex in Plan) {
                    if (!Plan.hasOwnProperty(TestForMultiLinesIndex)) continue;
                    if (parseInt(TestForMultiLinesIndex) <= parseInt(PlanIndex)) continue;
                    if (Plan[TestForMultiLinesIndex]) {
                        if (!Plan[TestForMultiLinesIndex]["Std."] && !Plan[TestForMultiLinesIndex]["Fach"] && !Plan[TestForMultiLinesIndex]["Lehrer"] && !Plan[TestForMultiLinesIndex]["statt"] && !Plan[TestForMultiLinesIndex]["Raum"] && parseInt(TestForMultiLinesIndex) > parseInt(PlanIndex)) {
                            LinesToAdd.push(TestForMultiLinesIndex);
                            debugger;
                        } else {
                            if (parseInt(TestForMultiLinesIndex) > parseInt(PlanIndex)) {
                                break;
                            }
                        }
                    } else {
                        break;
                    }
                }
                for (let LinesToAddIndex in LinesToAdd) {
                    if (LinesToAdd.hasOwnProperty(LinesToAddIndex)) {
                        Plan[PlanIndex]['Klasse(n)'] = Plan[PlanIndex]['Klasse(n)'] + Plan[LinesToAdd[LinesToAddIndex]]['Klasse(n)'];
                        Plan[PlanIndex]['Bemerkungen'] = Plan[PlanIndex]['Bemerkungen'] + Plan[LinesToAdd[LinesToAddIndex]]['Bemerkungen'];
                    }
                }
                needToRemove = needToRemove.concat(LinesToAdd);


                if (Plan[PlanIndex].Entfall != null && typeof Plan[PlanIndex].Entfall == 'string') Plan[PlanIndex].Entfall = Plan[PlanIndex].Entfall.toLowerCase() == "x";

                for (let key in Plan[PlanIndex]) {
                    if (Plan[PlanIndex].hasOwnProperty(key)) {
                        if (typeof Plan[PlanIndex][key] == 'string') {
                            Plan[PlanIndex][key] = Plan[PlanIndex][key].trim();
                            if (Plan[PlanIndex][key] == "") Plan[PlanIndex][key] = null;
                        }
                    }
                }

                if (Plan[PlanIndex]['Std.']) {
                    Plan[PlanIndex]['Std.'] = Plan[PlanIndex]['Std.'].replaceAll(/\s/, '');
                    if (Plan[PlanIndex]['Std.'].includes('-')) {
                        Plan[PlanIndex].Stunden = rangeParser.parse(Plan[PlanIndex]['Std.']);
                    } else {
                        Plan[PlanIndex].Stunden = [Plan[PlanIndex]['Std.']];
                    }
                }

                if (Plan[PlanIndex].Raum == "---") {
                    Plan[PlanIndex].Raum = null;
                }

                // 5678910111213ABBLCDMNMZAG -> JSON
                if (Plan[PlanIndex]['Klasse(n)']) {

                    let ClassParts = [];
                    const ClassesPartsRegex = /\d+\D+/g;
                    let m;
                    while ((m = ClassesPartsRegex.exec(Plan[PlanIndex]['Klasse(n)'])) !== null) {
                        if (m.index === ClassesPartsRegex.lastIndex) {
                            ClassesPartsRegex.lastIndex++;
                        }
                        ClassParts.push(m[0]);
                    }

                    Plan[PlanIndex].KlassenStufen = [];
                    Plan[PlanIndex].KlassenBuchstaben = [];
                    Plan[PlanIndex].Klassen = [];

                    for (let ClassPartsIndex in ClassParts){
                        if (!ClassParts.hasOwnProperty(ClassPartsIndex)) continue;
                        const CompleteClass = ClassParts[ClassPartsIndex];
                        const Years = CompleteClass.replaceAll(/\D/, '');
                        const Classes = CompleteClass.replaceAll(/\d/, '');
                        let localKlassenStufen = [];
                        let localKlassenBuchstaben = [];
                        for (let i = 5; i <= 13; i++) {
                            if (Years.match(i)) {
                                Plan[PlanIndex].KlassenStufen.push(i);
                                localKlassenStufen.push(i);
                            }
                        }
                        const ClassCharList = [
                            /A(?!G)/,
                            /B(?!L)/,
                            "C",
                            "D",
                            "BL",
                            "MN",
                            "MZ",
                            "AG"
                        ];
                        for (let i = 0; i < ClassCharList.length; i++) {
                            const match = Classes.match(ClassCharList[i]);
                            if (match) localKlassenBuchstaben.push(match[0]);
                            if (match && Plan[PlanIndex].KlassenBuchstaben.indexOf(match[0]) == -1) Plan[PlanIndex].KlassenBuchstaben.push(match[0]);
                        }
                        let localKlassen = [];
                        for (let Index in localKlassenStufen) {
                            if (localKlassenStufen.hasOwnProperty(Index)) {
                                const Stufe = localKlassenStufen[Index];
                                for (let BIndex in localKlassenBuchstaben) {
                                    if (localKlassenBuchstaben.hasOwnProperty(BIndex)) {
                                        const Buchstabe = localKlassenBuchstaben[BIndex];
                                        localKlassen.push(`${Stufe}${Buchstabe}`);
                                    }
                                }
                            }
                        }
                        Plan[PlanIndex]['Klassen'] = Plan[PlanIndex]['Klassen'].concat(localKlassen);
                    }
                    Plan[PlanIndex].GanzerJahrgang = Plan[PlanIndex].KlassenBuchstaben.length == 0 && Plan[PlanIndex].Klassen.length == 0;

                }


            }
        }
        //console.log(needToRemove);
        Plan.multisplice.apply(Plan, needToRemove);
        return Plan;
    }

    /**
     * Get the status
     * @param HTML
     * @private
     */
    static _getStatus(HTML) {
        const StatusRegex = /Stand:.*<\/p>/;
        let m = StatusRegex.exec(HTML)
        return m[0].replaceAll('Stand:', '').replaceAll('</p>', '').trim();
    }

}

String.prototype.replaceAll = function (search, replacement) {
    let target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

/**
 * @author http://upshots.org/actionscript/javascript-splice-array-on-multiple-indices-multisplice
 */
Array.prototype.multisplice = function () {
    let args = Array.apply(null, arguments);
    args.sort(function (a, b) {
        return a - b;
    });
    for (let i = 0; i < args.length; i++) {
        let index = args[i] - i;
        this.splice(index, 1);
    }
};

module.exports = DSBLibrary;