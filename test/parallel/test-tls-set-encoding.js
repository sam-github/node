// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

const options = {
  enableTrace: true,
  key: fixtures.readKey('agent2-key.pem'),
  cert: fixtures.readKey('agent2-cert.pem')
};

tls.DEFAULT_MAX_VERSION = 'TLSv1.3';

// Contains a UTF8 only character
const messageUtf8 = 'x√ab c';

// The same string above represented with ASCII
const messageAscii = 'xb\b\u001aab c';

const server = tls.Server(options, common.mustCall(function(socket) {
  console.log('* server: on connect, send message & close');
  socket.end(messageUtf8);
}));


server.listen(0, function() {
  const client = tls.connect({
    port: this.address().port,
    rejectUnauthorized: false
  });
  //client.enableTrace();

  let buffer = '';

  client.setEncoding('ascii');

  client.on('data', function(d) {
    console.log('* client: on data', d);
    assert.ok(typeof d === 'string');
    buffer += d;
  });

  client.on('secureConnect', () => {
    console.log('* client: on secureConnect');
  });

  client.on('close', function() {
    console.log('* client: on close');

    // readyState is deprecated but we want to make
    // sure this isn't triggering an assert in lib/net.js
    // See https://github.com/nodejs/node-v0.x-archive/issues/1069.
    assert.strictEqual(client.readyState, 'closed');

    // Confirming the buffer string is encoded in ASCII
    // and thus does NOT match the UTF8 string
    assert.notStrictEqual(messageUtf8, buffer);

    // Confirming the buffer string is encoded in ASCII
    // and thus does equal the ASCII string representation
    assert.strictEqual(messageAscii, buffer);

    server.close();
  });
});
