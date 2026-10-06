const path = require('path');

module.exports = {
  // js/app.js is JSX transformed in-browser by babel-standalone (see index.html),
  // not bundled by webpack — no entry/loader needed here.
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
};
