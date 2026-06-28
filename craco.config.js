const webpack = require('webpack');

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Polyfills for Node.js built-ins used by circomlibjs and snarkjs
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        assert: require.resolve('assert/'),
        buffer: require.resolve('buffer/'),
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        process: require.resolve('process/browser'),
        path: false,
        fs: false,
        os: false,
      };

      webpackConfig.plugins = [
        ...webpackConfig.plugins,
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        }),
      ];

      return webpackConfig;
    },
  },
};
