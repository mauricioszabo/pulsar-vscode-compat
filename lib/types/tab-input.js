'use strict';

class TabInputText {
  constructor(uri) {
    this.uri = uri;
  }
}

class TabInputNotebook {
  constructor(uri, notebookType) {
    this.uri = uri;
    this.notebookType = notebookType;
  }
}

class TabInputCustom {
  constructor(uri, viewType) {
    this.uri = uri;
    this.viewType = viewType;
  }
}

class TabInputWebview {
  constructor(viewType) {
    this.viewType = viewType;
  }
}

class TabInputTerminal {}

module.exports = {
  TabInputText,
  TabInputNotebook,
  TabInputCustom,
  TabInputWebview,
  TabInputTerminal
};
