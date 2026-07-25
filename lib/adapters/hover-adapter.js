'use strict';

const { createHoverService } = require('../service/hover');

// Registry of VSCode hover providers: {documentSelector, provider}
const hoverProviders = [];

function registerHoverProvider(documentSelector, provider) {
  const entry = { documentSelector, provider };
  hoverProviders.push(entry);
  return {
    dispose() {
      const index = hoverProviders.indexOf(entry);
      if (index !== -1) hoverProviders.splice(index, 1);
    }
  };
}

function provideHover() {
  return createHoverService(hoverProviders);
}

module.exports = { registerHoverProvider, provideHover, hoverProviders };
