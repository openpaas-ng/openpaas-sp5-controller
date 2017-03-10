'use strict';

const WebSocket = require('ws');

class Conference {
  constructor(confId) {
    this.id = confId;
    this.ws = new Set([]);
    this.chunks = [];
  }
}

module.exports = {

  confs: {},

  register: function(confId, ws) {
    // ensure conf exists
    if(!(confId in this.confs)) {
      this.confs[confId] = new Conference(confId);
    }
    this.confs[confId].ws.add(ws);
  },

  unregister: function(confId, ws) {
    if(!(confId in this.confs)) {
      console.error('trying to unregister to non-existing conf ' + confId);
      return;
    }
    this.confs[confId].ws.delete(ws);

  },

  delete: function(confId) {
    if(!(confId in this.confs)) {
      console.error('trying to delete non-existing conf ' + confId);
      return;
    }
    delete this.confs[confId];
  },

  saveTranscriptChunk: function(confId, chunk) {
    if(!(confId in this.confs)) {
      console.error('trying to saveTranscriptionChunk to non-existing conf ' + confId);
      return;
    }
    this.confs[confId].chunks.push(chunk);
  },

  pushEvent: function(confId, event) {
    if(!(confId in this.confs)) {
      console.error('trying to saveTranscriptionChunk to non-existing conf ' + confId);
      return;
    }
    this.confs[confId].ws.forEach((ws) => { ws.send(event); });
  }
};
