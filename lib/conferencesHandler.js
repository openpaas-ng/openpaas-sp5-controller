'use strict';

const WebSocket = require('ws');

class Conference {
  constructor(confId) {
    this.id = confId;
    this.ws = new Set([]);
    this.chunks = [];
    this.scheduledEvent = null;

    this.scheduleEvent = function(callback, interval, replace = true) {
      if(this.scheduledEvent != null){
        if(replace) {
          this.clearEvent();
        } else {
          return;
        }
      }
      this.scheduledEvent = setInterval(() => callback(confId), interval);
    };

    this.clearEvent = function(){
      if(this.scheduledEvent != null){
        clearInterval(this.scheduledEvent);
        this.scheduledEvent = null;
      }
    };
  }
}

module.exports = {

  confs: {},
  scheduledEvent: null,

  register: function(confId, ws) {
    // ensure conf exists
    if(!(confId in this.confs)) {
      this.confs[confId] = new Conference(confId);
    }
    this.confs[confId].ws.add(ws);

    // ensure scheduledEvent if defined
      this.confs[confId].scheduleEvent(this.scheduledEvent,
                                       this.scheduledEventInterval,
                                       false);
  },

  unregister: function(confId, ws) {
    if(!(confId in this.confs)) {
      console.error('trying to unregister to non-existing conf ' + confId);
      return;
    }
    this.confs[confId].ws.delete(ws);

    // disable possible scheduledEvent if nobody left
    if(this.confs[confId].ws.size == 0) {
      this.confs[confId].clearEvent();
    }

  },

  delete: function(confId) {
    if(!(confId in this.confs)) {
      console.error('trying to delete non-existing conf ' + confId);
      return;
    }
    this.confs[confId].clearEvent();
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
  },

  getTranscript: function(confId) {
    if(!(confId in this.confs)) {
      return [];
    } else {
      return this.confs[confId].chunks;
    }
  },

  scheduleEvent: function(callback, interval) {
    this.scheduledEvent = callback;
    this.scheduledEventInterval = interval;

    // replaced scheduledEvent for all existing confs
    for (let confId in this.confs) {
      this.confs[confId].scheduleEvent(this.scheduledEvent,
                                       this.scheduledEventInterval);
    }
  }
};
