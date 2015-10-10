var C = require('./lib/c');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var usbtinyisp = require('usbtinyisp');
var bufferEqual = require('buffer-equal');
var async = require('async');
//var usb = require('usb');

function avrgirlUsbTinyIsp (options) {
  // set up noisy or quiet
  this.debug = options.debug ? console.log : function() {};

  // most people won't need this level of debug output
  var hackerMode = options.hackerMode || false;

  this.options = {
    sck: options.sck || C.SCK_DEFAULT,
    debug: options.debug || false,
    chip: options.chip,
    // for usbtinyisp lib
    log: hackerMode ? this.debug : function() {},
    programmer: options.programmer || null
  };

  var p = this.options.programmer;
  this.options.pid = p ? p.pid : 3231;
  this.options.vid = p ? p.vid : 6017;

  //console.log(usb.getDeviceList());

  this.programmer = new usbtinyisp(this.options);

  EventEmitter.call(this);

  var self = this;
  this.programmer.open(function() {
    setImmediate(emitReady, self);
  });
}

util.inherits(avrgirlUsbTinyIsp, EventEmitter);

function emitReady (self) {
  self.emit('ready');
}

avrgirlUsbTinyIsp.prototype.enterProgrammingMode = function (callback) {
  var self = this;
  var cmd = new Buffer(this.options.chip.pgmEnable);

  this.setSCK(this.options.sck, function(error) {
    if (error) { return callback(error) }
    // is this timeout necessary?
    setTimeout(function() {
      self.programmer.spi(cmd, function (error) {
        return callback(error);
      });
    }, 50);
  });
};

avrgirlUsbTinyIsp.prototype.exitProgrammingMode = function (callback) {
  this.programmer.powerDown(function (error) {
    return callback(error);
  });
};

avrgirlUsbTinyIsp.prototype.setSCK = function (rate, callback) {
  // preparing for next version is usbtinyisp to be published allowing for custom clock rate
  if (!callback) {
    var callback = rate;
  }

  if (typeof rate !== 'number' || rate < C.SCK_MIN || rate > C.SCK_MAX) {
    return callback(new Error('Could not set SCK: rate should be a number between ' + C.SCK_MIN + ' and ' + C.SCK_MAX + '.'));
  }

  this.programmer.setSCK(function(error) {
    return callback(error);
  });
};

avrgirlUsbTinyIsp.prototype.getChipSignature = function (callback) {
  var response = [];
  var signature = this.options.chip.signature;
  var cmd = new Buffer(signature.read);
  var sigLen = signature.size;
  var set = 0;
  var sigPos = 3;

  var self = this;

  function getSigByte() {
    self.programmer.spi(cmd, function (error, data) {
      if (error) { return callback(error); }
      response[set] = data[sigPos];
      set += 1;
      cmd[2] = set;
      if (set < sigLen) {
        getSigByte();
      } else {
        callback(null, response);
      }
    });
  };

  getSigByte();
};

avrgirlUsbTinyIsp.prototype.verifySignature = function (sig, data, callback) {
  var error = null;
  if (!bufferEqual(data, sig)) {
    error = new Error('Failed to verify: signature does not match.');
  }
  callback(error);
};

avrgirlUsbTinyIsp.prototype.writeMem = function (memType, hex, callback) {
  var self = this;
  var options = this.options.chip;
  var pageAddress = 0;
  var useAddress;
  var pageSize = options[memType].pageSize;
  var addressOffset = options[memType].addressOffset;
  var addressOffset = 1;
  var data;

  async.whilst(
    function testEndOfFile() {
      return pageAddress < hex.length;
    },
    function programPage (pagedone) {
      async.series([
        function writeToPage (done) {
          data = hex.slice(pageAddress, (hex.length > pageSize ? (pageAddress + pageSize) : hex.length - 1));
          // fix this hard coded 0 delay
          self.loadPage(memType, 0, pageAddress, data, done);
        },
        function loadAddress (done) {
          useAddress = pageAddress >> addressOffset;
         self.loadAddress(memType, useAddress, done);
        },
        function calcNextPage (done) {
          pageAddress = pageAddress + pageSize;
          setTimeout(done, 6);
        }
      ],
      function pageIsDone (error) {
        pagedone(error);
      });
    },
    function (error) {
      return callback(error);
    }
  );
};

avrgirlUsbTinyIsp.prototype.loadPage = function (memType, delay, address, buffer, callback) {
  if (memType === 'flash') {
    this.programmer.writeFlash(delay, address, buffer, function (error, result) {
      return callback(error);
    });
  } else {
    this.programmer.writeEeprom(delay, address, buffer, function (error, result) {
      return callback(error);
    });
  }
};

avrgirlUsbTinyIsp.prototype.loadAddress = function (memType, address, callback) {
  var memCmd = this.options.chip[memType].write[1];
  var low = address & 0xff;
  var high = (address >> 8) & 0xff;
  var cmd = new Buffer([memCmd, high, low, 0x00]);

  this.programmer.spi(cmd, function(error, result) {
    return callback(error, result);
  });
}

avrgirlUsbTinyIsp.prototype.writeFlash = function (hex, callback) {
  // optional convenience method
  this.writeMem('flash', hex, function (error) {
    return callback(error);
  });
};

avrgirlUsbTinyIsp.prototype.readFlash = function (length, address, callback) {
  return this.programmer.readFlash(this.options.chip.flash.delay, address, length, callback);
};

avrgirlUsbTinyIsp.prototype.writeEeprom = function (hex, callback) {
   // optional convenience method
  this.writeMem('eeprom', hex, function (error) {
    return callback(error);
  });
};

avrgirlUsbTinyIsp.prototype.readEeprom = function (length, address, callback) {
  return this.programmer.readEeprom(this.options.chip.eeprom.delay, address, length, callback);
};

avrgirlUsbTinyIsp.prototype.eraseChip = function (callback) {
  this.programmer.spi(new Buffer(this.options.chip.erase.cmd), function (error) {
    return callback(error);
  });
};

module.exports = avrgirlUsbTinyIsp;
