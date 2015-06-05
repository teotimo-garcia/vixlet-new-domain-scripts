/* global require, module, process */

'use strict';

var _ = require('lodash');
var Promise = require('bluebird');
var superagent = require('superagent-bluebird-promise');
var MongoClient = require('mongodb').MongoClient;
var bcrypt = require('bcrypt-nodejs');

var clientId = process.env.CLIENT_ID;
var userOAuthMongoDbUri = process.env.MONGODB_MULTI_OAUTHUSER;

var officialUserCounter = 0;
var passwordArray = process.env.OFFICIAL_USER_PASSWORDS.split(',');
var emailArray = process.env.OFFICIAL_USER_EMAILS.split(',');
var firstNameArray = process.env.OFFICIAL_USER_FIRST_NAMES.split(',');
var lastNameArray = process.env.OFFICIAL_USER_LAST_NAMES.split(',');
var officialUsers = _.map(process.env.OFFICIAL_USER_USERNAMES.split(','), function(username) {
  var officialUser =  {
    username: username.toLowerCase(),
    password: passwordArray[officialUserCounter],
    email: emailArray[officialUserCounter].toLowerCase(),
    firstName: firstNameArray[officialUserCounter],
    lastName: lastNameArray[officialUserCounter],
    clientId: clientId,
    gender: 'M',
    birthDate: 635284107410
  };
  var salt = bcrypt.genSaltSync(10);
  officialUser.encrypted_password = bcrypt.hashSync(officialUser.password, salt);
  officialUserCounter++;
  return officialUser;
});

var baseUserApiUrl = 'http://' + process.env.VIXLET_API_HOST + '/user';
var promises = _.map(officialUsers, function(officialUser) {
  return superagent.post(baseUserApiUrl, officialUser)
    .then(function(result) {
      officialUser.id = result.body.id;
      console.log('User created: ' + result.body.username);
      return Promise.resolve();
    })
    .catch(function(err) {
      if (err.status === 400 && err.body.message === 'That username already exists') {
        console.warn('User already exists: ' + officialUser.username);
        return Promise.resolve();
      }
      console.error('ERROR!');
      console.error(err);
      return Promise.reject(err);
    });
});
return Promise.all(promises)
  .then(function() {
    return new Promise(function(resolve, reject) {
      MongoClient.connect(userOAuthMongoDbUri, function(err, db) {
        if (err) {
          return reject(err);
        }
        var promises = _.map(officialUsers, function(officialUser) {
          return new Promise(function(resolve, reject) {
            db.collection('user').findOneAndUpdate(
              { username: officialUser.username },
              {
                $set: {
                  isOfficialUser: true,
                  isBrandUser: true,
                  becameOfficial: new Date(),
                  becameBrand: new Date(),
                  status: 1,
                  encrypted_password: officialUser.encrypted_password
                }
              },
              function(err) {
                if (err) {
                  return reject(err);
                }
                return resolve();
              }
            );
          });
        });
        Promise.all(promises)
          .then(function() {
            resolve();
          })
          .finally(function() {
            db.close();
          });
      });
    });
  })
  .then(function() {
    var tokenUrl = 'http://' + process.env.VIXLET_API_HOST + '/oauth/token';
    var promises = _.map(officialUsers, function(officialUser) {
      var params = {
        'clientId': clientId,
        'grantType': 'password',
        'username': officialUser.username,
        'password': officialUser.password
      };
      return superagent.post(tokenUrl, params)
        .then(function(result) {
          var updateParams = { bio: 'Hello!' };
          //console.log('=========================');
          //console.log(result.body);
          //console.log('=========================');
          return superagent.put(baseUserApiUrl, updateParams)
            .set('Authorization', 'Bearer ' + result.body.token)
            .catch(function(err) {
              console.error('Error while trying to update user to force Riak dual-write for user ' + params.username);
              console.error(err);
              return Promise.reject(err);
            });
        });
    });
    return Promise.all(promises);
  })
  .then(function() {
    console.log('DONE!');
  })
  .catch(function(err) {
    console.error(err);
  });