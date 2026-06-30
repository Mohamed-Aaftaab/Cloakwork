const webpack = require('webpack');
const path = require('path');

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Polyfills for Node.js built-ins used by circomlibjs, snarkjs, and stellar-sdk
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        assert: require.resolve('assert/'),
        buffer: require.resolve('buffer/'),
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        path: false,
        fs: false,
        os: false,
      };

      // Alias 'process/browser' to the .js variant — needed for @stellar/stellar-sdk v14+
      // which uses strict ESM and requires fully-specified extensions in imports.
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        'process/browser': require.resolve('process/browser.js'),
      };

      webpackConfig.plugins = [
        ...webpackConfig.plugins,
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: ['process/browser.js'],
        }),
      ];

      // Allow webpack to resolve .mjs files from node_modules (stellar-sdk v14+ uses ESM)
      webpackConfig.module.rules.push({
        test: /\.m?js/,
        resolve: {
          fullySpecified: false,
        },
      });

      // Disable source-map-loader for node_modules to prevent ENOENT errors
      // when packages ship source maps pointing to files not included in the npm tarball.
      webpackConfig.module.rules = webpackConfig.module.rules.map((rule) => {
        if (rule.enforce === 'pre' && rule.use) {
          const uses = Array.isArray(rule.use) ? rule.use : [rule.use];
          const hasSourceMapLoader = uses.some(
            (u) => (typeof u === 'string' && u.includes('source-map-loader')) ||
                    (u && u.loader && u.loader.includes('source-map-loader'))
          );
          if (hasSourceMapLoader) {
            return {
              ...rule,
              exclude: /node_modules/,
            };
          }
        }
        return rule;
      });

      return webpackConfig;
    },
  },
};
