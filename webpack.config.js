const path = require('path');

module.exports = {
    mode: "development",
    devtool: "inline-source-map",
    entry: {
        main: "./src/provider/index.ts",
    },
    output: {
        path: path.resolve(__dirname, './build'),
        filename: "provider.js"
    },
    resolve: {
        extensions: [".ts", ".js"],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: "ts-loader",
                options: {
                    configFile: "tsconfig.provider.json"
                }
            }
        ]
    }
};
