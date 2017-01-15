const async = require('async');
const request = require('request');
const fs = require('fs');
const cheerio = require('cheerio');
const XRegExp = require('xregexp');
const sanitize = require("sanitize-filename");

let cookies = null;
try {
    cookies = require('./cookie_cache.json');
} catch (e) {
    console.log("No cookie cache or invalid.");
}

let config = null;
try {
    config = require('./config.json');
} catch (e) {
    console.log("Config invalid or does not exists.");
    process.exit(1);
}

function login(callback) {
    request.post(`https://${config.host}/iserv/login_check`, {
        form: {
            _username: config.username,
            _password: config.password
        }
    }, (error, response, body) => {
        if (!error && response.statusCode == 302) {
            if (response.headers["set-cookie"]){
                cookies = {};
                for (let u in response.headers["set-cookie"]){
                    const current = response.headers["set-cookie"][u];
                    const m = /^[^;]+/.exec(current);
                    if (m){
                        const CookieSplit = m[0].split("=");
                        if (CookieSplit[0] && CookieSplit[1]){
                            cookies[CookieSplit[0]] = CookieSplit[1];
                        }
                    }
                }
                fs.writeFile(`${__dirname}/cookie_cache.json`, JSON.stringify({
                    cookies: cookies
                }), (err) => {
                    if (err){
                        console.error(err);
                        process.exit(1);
                    }
                    callback();
                });
            } else {
                console.error(`No cookies. No session.`);
                process.exit(1);
            }
        } else {
            console.error(`Something went wrong. ${error} ${JSON.stringify(response)}`);
            process.exit(1);
        }
    });
}
let cookieString;

async.waterfall([
    (WCallback) => {
        if (cookies){
            console.log("Test session...");
            let cookieString = "";
            for (let CookieIndex in cookies.cookies){
                if (cookies.cookies.hasOwnProperty(CookieIndex)) {
                    cookieString = cookieString + `${CookieIndex}=${cookies.cookies[CookieIndex]}; `;
                }
            }
            request(`https://${config.host}/iserv/login_check`, {
                headers: {
                    Cookie: cookieString
                },
                followRedirect: false
            },(error, response, body) => {
                if (!error && response.statusCode == 200) {
                    WCallback();
                } else {
                    login(WCallback);
                }
            });
        } else {
            login(WCallback);
        }
    },
    (WCallback) => {
        console.log("Login successfully");
        cookieString = "";
        for (let CookieIndex in cookies){
            if (cookies.hasOwnProperty(CookieIndex)) {
                cookieString = cookieString + `${CookieIndex}=${cookies[CookieIndex]}; `;
            }
        }
        //console.log(cookieString);
        request(`https://${config.host}/iserv/plan/show/raw/DSB%20Schueler`, {
            headers: {
                Cookie: cookieString
            }
        }, (error, response, body) => {
            if (!error && response.statusCode == 200) {
                WCallback(null, body, cookieString);
            } else {
                console.error(error);
                process.exit(1);
            }
        })
    },
    (body, CookieString, WCallback) => {
        //console.log(body);
        const $ = cheerio.load(body);
        const src = $('iframe[name="DSBHPLehrer"]').attr('src');
        if (src){
            WCallback(null, src, CookieString);
        } else {
            process.exit(1);
        }
    },
    (NextSrc,CookieString , WCallback) => {
        request(NextSrc, {
            headers: {
                Cookie: CookieString
            }
        }, (error, response, body) => {
            if (!error && response.statusCode == 200) {
                WCallback(null, body, NextSrc);
            } else {
                console.error(error);
                process.exit(1);
            }
        });
    },
    (Body, NextSrc , WCallback) => {
        const $ = cheerio.load(Body);
        const src = $('iframe').attr('src');
        if (src){
            WCallback(null, src, NextSrc);
        } else {
            process.exit(1);
        }
    },
    (NextSrc, Referer, WCallback) => {
        request(NextSrc, {
            headers: {
                Cookie: cookieString,
                Referer: Referer
            }
        }, (error, response, body) => {
            if (!error && response.statusCode == 200) {
                WCallback(null, body);
            } else {
                console.error(error);
                process.exit(1);
            }
        });
    },
    (body, WCallback) => {
        //console.log(body);
        const $ = cheerio.load(body);
        const src1 = $('iframe[name="Vertretungsplan-Modul 2"]').attr('src');
        const src2 = $('iframe[name="Vertretungsplan-Modul"]').attr('src');
        WCallback(null, src1, src2);
    },
    (Src1, Src2, WCallback) => {
         parseThisShittyIframeAgain(Src1, () => {
             parseThisShittyIframeAgain(Src2, () => {
                 WCallback();
             });
         });
    }
],() => {
    process.exit(1);
});


function parseThisShittyIframeAgain(Src, callback){
    if (!Src){
        callback();
    } else {
        request(Src, (error, response, body) => {
            if (!error && response.statusCode == 200) {
                const superRegex = /location.href=".+(?=";)/;
                const m = superRegex.exec(body);
                const src = m[0].replace('location.href="', '');
                if (src){
                    request(src, {
                        headers: {
                            Referer: Src
                        }
                    },(error, response, body) => {
                        if (!error && response.statusCode == 200) {
                            const $ = cheerio.load(body);
                            const TheLastLink = $('iframe').attr('src');
                            if (TheLastLink){
                                request(TheLastLink, (error, response, body) => {
                                    if (!error && response.statusCode == 200) {
                                        /**
                                         * @author http://stackoverflow.com/users/1537042/ofir-luzon, http://stackoverflow.com/users/402884/chris-martin
                                         * @type {RegExp}
                                         */
                                        const regexForDate = /^(?:(?:31(\/|-|\.)(?:0?[13578]|1[02]))\1|(?:(?:29|30)(\/|-|\.)(?:0?[1,3-9]|1[0-2])\2))(?:(?:1[6-9]|[2-9]\d)?\d{2})$|^(?:29(\/|-|\.)0?2\3(?:(?:(?:1[6-9]|[2-9]\d)?(?:0[48]|[2468][048]|[13579][26])|(?:(?:16|[2468][048]|[3579][26])00))))$|^(?:0?[1-9]|1\d|2[0-8])(\/|-|\.)(?:(?:0?[1-9])|(?:1[0-2]))\4(?:(?:1[6-9]|[2-9]\d)?\d{2})/;

                                        const $ = cheerio.load(body);
                                        const J = $(".mon_title");
                                        const date = regexForDate.exec(J.contents()[0].data)[0];
                                        console.log(`Found: ${date}`);

                                        fs.writeFile(`${__dirname}/${sanitize(J.contents()[0].data)}.html`, body, () => {
                                            callback();
                                        });
                                    } else {
                                        process.exit(1);
                                    }
                                });
                            } else {
                                process.exit(1);
                            }
                        } else {
                            process.exit(1);
                        }
                    });
                } else {
                    console.log("IS NULKLLLLLLL");
                    process.exit(1);
                }
            } else {
                console.error(error);
                process.exit(1);
            }
        });
    }
}
