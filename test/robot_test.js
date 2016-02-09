var chai = require('chai');
var sinon = require('sinon');
var Promise = require('bluebird');
var nock = require('nock');

var Robot = require('../src/robot');
var TextMessage = require('../src/message').TextMessage;
var User = require('../src/user');

chai.use(require('sinon-chai'));
var expect = chai.expect;

describe('Robot', function() {
  beforeEach(function() {
    this.robot = new Robot('TDEADBEEF', 'UNESTORBOT1', false);
    this.user = new User('1', {
      name: 'nestorbottester',
      room: 'CDEADBEEF1'
    });
  })

  describe('Unit Tests', function() {
    describe('#http', function() {
      beforeEach(function() {
        var url;
        url = 'http://localhost';
        this.httpClient = this.robot.http(url);
      });

      it('creates a new ScopedHttpClient', function() {
        expect(this.httpClient).to.have.property('get');
        expect(this.httpClient).to.have.property('post');
      });

      it('passes options through to the ScopedHttpClient', function() {
        var agent, httpClient;
        agent = {};
        httpClient = this.robot.http('http://localhost', {
          agent: agent
        });
        expect(httpClient.options.agent).to.equal(agent);
      });

      it('sets a sane user agent', function() {
        expect(this.httpClient.options.headers['User-Agent']).to.contain('Nestorbot');
      });

      it('merges in any global http options', function() {
        var agent, httpClient;
        agent = {};
        this.robot.globalHttpOptions = {
          agent: agent
        };
        httpClient = this.robot.http('http://localhost');
        expect(httpClient.options.agent).to.equal(agent);
      });

      it('local options override global http options', function() {
        var agentA, agentB, httpClient;
        agentA = {};
        agentB = {};
        this.robot.globalHttpOptions = {
          agent: agentA
        };
        httpClient = this.robot.http('http://localhost', {
          agent: agentB
        });
        expect(httpClient.options.agent).to.equal(agentB);
      });
    });

    describe('#hear', function() {
      it('registers a new listener directly', function() {
        expect(this.robot.listeners).to.have.length(0);
        this.robot.hear(/.*/, function() {});
        expect(this.robot.listeners).to.have.length(1);
      });
    });

    describe('#respond', function() {
      it('registers a new listener directly', function() {
        expect(this.robot.listeners).to.have.length(0);
        this.robot.respond(/.*/, function() {});
        expect(this.robot.listeners).to.have.length(1);
      });
    });

    describe('#respondPattern', function() {
      it('matches messages starting with robot\'s name', function() {
        var testMessage = this.robot.botId + ' message123';
        var testRegex = /(.*)/;
        var pattern = this.robot.respondPattern(testRegex);
        expect(testMessage).to.match(pattern);

        var match = testMessage.match(pattern)[1];
        expect(match).to.equal('message123');
      });

      it('matches messages starting with robot\'s name (in Slack style)', function() {
        var testMessage = "<@" + this.robot.botId + "|nestorbot>: " + 'message123';
        var testRegex = /(.*)/;
        var pattern = this.robot.respondPattern(testRegex);
        expect(testMessage).to.match(pattern);

        var match = testMessage.match(pattern)[1];
        expect(match).to.equal('message123');
      });

      it('does not match unaddressed messages', function() {
        var pattern, testMessage, testRegex;
        testMessage = 'message123';
        testRegex = /(.*)/;
        pattern = this.robot.respondPattern(testRegex);
        expect(testMessage).to.not.match(pattern);
      });
    });

    describe('#loadFile', function() {
      beforeEach(function() {
        this.sandbox = sinon.sandbox.create();
      });

      afterEach(function() {
        this.sandbox.restore();
      });

      it('should require the specified file', function() {
        var module = require('module');
        var script = sinon.spy(function(robot) {});
        this.sandbox.stub(module, '_load').returns(script);
        this.robot.loadFile('./scripts', 'test-script.js');
        expect(module._load).to.have.been.calledWith('scripts/test-script');
      });

      describe('proper script', function() {
        beforeEach(function() {
          var module = require('module');
          this.script = sinon.spy(function(robot) {});
          this.sandbox.stub(module, '_load').returns(this.script);
        });

        it('should call the script with the Robot', function() {
          this.robot.loadFile('./scripts', 'test-script.js');
          expect(this.script).to.have.been.calledWith(this.robot);
        });
      });

      describe('non-Function script', function() {
        beforeEach(function() {
          var module = require('module');
          this.script = {};
          this.sandbox.stub(module, '_load').returns(this.script);
        });

        it('logs a warning', function() {
          sinon.stub(this.robot.logger, 'warning');
          this.robot.loadFile('./scripts', 'test-script.js');
          expect(this.robot.logger.warning).to.have.been.called;
        });
      });
    });

    describe('#receive', function() {
      var testMessage, callback1, callback2;

      beforeEach(function() {
        testMessage = new TextMessage(this.user, 'message123');
      });

      context('debug mode', function() {
        beforeEach(function() {
          this.robot.debugMode = true;
          this.robot.listeners = [];
        });

        context('two handlers with the same callback', function(done) {
          beforeEach(function() {
            callback1 = function(response) { response.send('hello 1'); };
            callback2 = function(response) { response.send('hello 2'); };

            this.robot.hear(/message123/, callback1);
            this.robot.hear(/message123/, callback2);
          });

          it('should call callback1 and not callback2', function(done) {
            var _this = this;
            this.robot.receive(testMessage, function() {
              expect(_this.robot.toSend).to.eql(['hello 1']);
              done();
            });
          });
        });

        context('only one of the handlers match', function(done) {
          beforeEach(function() {
            callback1 = function(response) { response.send('hello 1'); };
            callback2 = function(response) { response.send('hello 2'); };

            this.robot.respond(/message456/, callback1);
            this.robot.hear(/message123/, callback2);
          });


          it('should call callback1 and not callback2', function(done) {
            var _this = this;
            this.robot.receive(testMessage, function() {
              expect(_this.robot.toSend).to.eql(['hello 2']);
              done();
            });
          });
        });

        context('handler has an asynchronous function', function(done) {
          beforeEach(function() {
            nock.disableNetConnect();
            nock('https://api.github.com', {
                    reqheaders: {
                      'accept': 'application/json'
                    }
                  }).
                  get('/user/show/technoweenie').
                  reply(200, JSON.stringify({user: 'technoweenie'}));

            callback1 = function(response, complete) {
              response.robot.http('https://api.github.com').
                             header('accept', 'application/json').
                             path('user/show/technoweenie')
                             .get()(function(err, resp, body) {
                               r = JSON.parse(body);
                               response.send(r['user']);
                               complete();
                             });
            };

            this.robot.hear(/message123/, callback1);
          });

          it('should call callback1 and wait for the http request to complete', function(done) {
            var _this = this;
            this.robot.receive(testMessage, function() {
              expect(_this.robot.toSend).to.eql(['technoweenie']);
              done();
            });
          });
        });
      });
    });
  });
});

