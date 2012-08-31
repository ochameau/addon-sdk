/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

let { Class } = require('./heritage');
let { EventTarget } = require('./event/target');
let { Namespace } = require('./namespace');
let { enqueue, dequeue, isQueued, queued } = require("./queue");

let connectedPeer = ns();
let queuedMessages = ns();

// Returns `true` if given `port` is connected.
var isConnected = Method();
exports.isConnected = isConnected;

// Connects given `port` to a given `target`.
// Throws exception if `port` is already connected.
var connect = Method();
exports.connect = connect;

// Disconnects given `port`.
var disconnect = Method();
exports.disconnect = disconnect;

// Returns peer given `port` is connected to.
var peer = Method();
exports.peer = exports.peer;

// Flushes all the queued messages to a connected peer.
var flush = Method();
exports.flush = flush;

// Defines port type.
let Port = Class({
  extends: EventTarget,
  initialize: function() {
    queuedMessages(this).value = [];
  },
  emit: function(message) {
    enqueue(this, message);
    if (isConnected(this))
      flush(this);
  }
});

queued.define(Port, function(port) {
  return queuedMessages(port).value;
});

connect.define(Port, function(port, target) {
	if (isConnected(port))
		throw Error("This port already has connected peer");
	
  // First make peer connect to this one.
  connectedPeer(port).peer = target;
});

disconnect.define(Port, function(port) {
  // If port has a live connection flush all the queued
  // messages.
  if (isConnected(port))
    flush(port);
  // If port has no connection then remove queued massages.
  else
    enqueued(port).splice(0);

  // Remove reference to a connected peer.
  delete connectedPeer(port).peer;
});

peer.define(Port, function(port) {
	// returns connected peer.
	return connectedPeer(port).port;
});

isConnected.define(Port, function(port) {
	// returns `true` if port has a connected peer.
  return !!peer(port);
});

flush.define(Port, function(port) {
  var target = peer(port);
  while (isQueued(port))
    emit(target, dequeue(port));
});