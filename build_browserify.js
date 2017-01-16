const fs = require("fs");
const browserify = require("browserify");
const UglifyJS = require("uglify-js");

browserify("./browser_.js")
    .transform("babelify", {presets: ["es2015"]})
    .bundle()
    .pipe(fs.createWriteStream("./build/browser.js")).on('close', function () {
    const result = UglifyJS.minify("./build/browser.js", {
        outSourceMap: "browser.min.js.map"
    });
    fs.writeFileSync('./build/browser.min.js', result.code);
    fs.writeFileSync('./build/browser.min.js.map', result.map);
});