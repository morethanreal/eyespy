/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

// jshint node: true

'use strict';

var async = require('async');
var _ = require('lodash');
var semver = require('semver');
var GH = require('github');

var LIMIT = 20;

var github = new GH({
  version: '3.0.0'
});

var config;

var logger = function(){};

function authenticate(token) {
  github.authenticate({
    type: 'oauth',
    token: token
  });
}

// reduce all the paginated results from github into one array
function accumulate(fn, cb) {
  var full = [];
  return function afn(err, response) {
    if (err) {
      return cb(err);
    }
    var intermediate = fn(response);
    full = full.concat(_.compact(intermediate));
    if (!github.hasNextPage(response)) {
      cb(null, full);
    } else {
      github.getNextPage(response, afn);
    }
  };
}

// flatten nested arrays one level
function flatten(cb) {
  return function(err, xs) {
    if (err) {
      return cb(err);
    } else {
      cb(null, _.flatten(xs, true));
    }
  };
}

function getApiLimit(cb) {
  github.misc.rateLimit({}, function(err, res) {
    if (err) {
      return cb(err);
    }
    cb(null, res.resources.core);
  });
}

function blackListed(repo) {
  var blacklist = config.blacklist;
  if (!blacklist) return false;
  var org = blacklist[repo.user];
  if (!org) return false;
  var explicit = org.repos && org.repos.indexOf(repo.repo) > -1;
  if (explicit) {
    logger('repo blacklisted explicity: ' + repo.user + '/' + repo.repo);
    return true;
  } else if (Array.isArray(org.regex)) {
    var matched = org.regex.some(function(rgx) {
      var m = rgx.test(repo.repo);
      if (m) {
        logger('repo blacklisted by regex: ' + rgx + ' ' + repo.user + '/' + repo.repo);
      }
      return m;
    });
    return matched;
  }
  return false;
}

function search(fin) {
  async.waterfall([
    function (callback) {
      async.map(config.orgs, function(org, next) {
        logger('getting repos for ' + org);
        github.repos.getFromOrg({org: org, type: 'public'}, function(err, res) {
          accumulate(function(array) {
            return _.chain(array)
            .map(function(r) {
              return {repo: r.name, user: r.owner.login};
            })
            .filter(function(r) {
              return !blackListed(r);
            })
            .value();
          }, next)(err, res);
        });
      }, flatten(callback));
    },
    function (repos, callback) {
      async.mapLimit(repos, LIMIT, function(r, next) {
        logger('getting statistics for ' + r.user + '/' + r.repo);
        github.repos.getStatsContributors(r, function(err, contribs) {
          var s = _.find(contribs, function(c) {
            return c.author && c.author.login == 'morethanreal';
          });
          var nc = _.reduce(contribs, function(total, c) {
            logger(c.total + ',' + total);
            return total + c.total;
          }, 0);
          next(err, {
            user: r.user,
            repo: r.repo,
            stats: s,
            commits: nc
          });
        });
      }, function(err, stats) {
        callback(null, stats);
      });
    }
  ], fin);
}

module.exports = {
  authenticate: authenticate,
  setConfig: function(c) {
    config = c;
  },
  setLogger: function(fn) {
    logger = fn;
  },
  getApiLimit: getApiLimit,
  go: search
};
