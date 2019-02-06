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
const cluster = require('cluster');
const fixtures = require('../common/fixtures');

const workerCount = 4;
const expectedReqCount = 16;

if (cluster.isMaster) {
  let reusedCount = 0;
  let reqCount = 0;
  let lastSession = null;
  let shootOnce = false;
  let workerPort = null;

  function shoot() {
    console.error('[master] connecting', workerPort);
    const c = tls.connect(workerPort, {
      session: lastSession,
      rejectUnauthorized: false
    }).on('data', () => {
        c.end(); // XXX probably a bug, see comment on server side.
    }).on('close', () => {
      // Wait for close to shoot off another connection. We don't want to shoot
      // until a new session is allocated, if one will be. The new session is
      // not guaranteed on secureConnect (it depends on TLS1.2 vs TLS1.3), but
      // it is guaranteed to happen before the connection is closed.
      if (++reqCount === expectedReqCount) {
        Object.keys(cluster.workers).forEach(function(id) {
          cluster.workers[id].send('die');
        });
      } else {
        shoot();
      }
    }).once('session', (session) => {
      lastSession = session;
    });
  }

  function fork() {
    const worker = cluster.fork();
    worker.on('message', ({ msg, port }) => {
      console.error('[master] got %j', msg);
      if (msg === 'reused') {
        ++reusedCount;
      } else if (msg === 'listening' && !shootOnce) {
        workerPort = port || workerPort;
        shootOnce = true;
        shoot();
      }
    });

    worker.on('exit', () => {
      console.error('[master] worker died');
    });
  }
  for (let i = 0; i < workerCount; i++) {
    fork();
  }

  process.on('exit', () => {
    assert.strictEqual(reqCount, expectedReqCount);
    assert.strictEqual(reusedCount + 1, reqCount);
  });
  return;
}

const key = fixtures.readSync('agent.key');
const cert = fixtures.readSync('agent.crt');

const options = { key, cert };

const server = tls.createServer(options, (c) => {
  if (c.isSessionReused()) {
    process.send({ msg: 'reused' });
  } else {
    process.send({ msg: 'not-reused' });
  }
  // c.end();
  // XXX on some conditions doing .end() here causes ECONNRESET
  // errors (not totally clear on what side, but probably worker side). This
  // seems to be a bug, possibly related to timeing of TLS1.3 key updates and
  // what node thinks will happen after a .end()/SSL_shutdown().  Need to
  // investigate more. For now, ending on client after receiving the 'bye'
  // makes test "pass"
  c.write('bye');
});

server.listen(0, () => {
  const { port } = server.address();
  process.send({
    msg: 'listening',
    port,
  });
});

process.on('message', function listener(msg) {
  console.error('[worker] got %j', msg);
  if (msg === 'die') {
    server.close(() => {
      console.error('[worker] server close');

      process.exit();
    });
  }
});

process.on('exit', () => {
  console.error('[worker] exit');
});
