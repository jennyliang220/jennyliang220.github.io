window._mipStartTiming = Date.now();


(function(global){

//
// Check for native Promise and it has correct interface
//

var NativePromise = global['Promise'];
var nativePromiseSupported =
  NativePromise &&
  // Some of these methods are missing from
  // Firefox/Chrome experimental implementations
  'resolve' in NativePromise &&
  'reject' in NativePromise &&
  'all' in NativePromise &&
  'race' in NativePromise &&
  // Older version of the spec had a resolver object
  // as the arg rather than a function
  (function(){
    var resolve;
    new NativePromise(function(r){ resolve = r; });
    return typeof resolve === 'function';
  })();


//
// export if necessary
//

if (typeof exports !== 'undefined' && exports)
{
  // node.js
  exports.Promise = nativePromiseSupported ? NativePromise : Promise;
  exports.Polyfill = Promise;
}
else
{
  // AMD
  if (typeof define == 'function' && define.amd)
  {
    define(function(){
      return nativePromiseSupported ? NativePromise : Promise;
    });
  }
  else
  {
    // in browser add to global
    if (!nativePromiseSupported)
      global['Promise'] = Promise;
  }
}


//
// Polyfill
//

var PENDING = 'pending';
var SEALED = 'sealed';
var FULFILLED = 'fulfilled';
var REJECTED = 'rejected';
var NOOP = function(){};

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

// async calls
var asyncSetTimer = typeof setImmediate !== 'undefined' ? setImmediate : setTimeout;
var asyncQueue = [];
var asyncTimer;

function asyncFlush(){
  // run promise callbacks
  for (var i = 0; i < asyncQueue.length; i++)
    asyncQueue[i][0](asyncQueue[i][1]);

  // reset async asyncQueue
  asyncQueue = [];
  asyncTimer = false;
}

function asyncCall(callback, arg){
  asyncQueue.push([callback, arg]);

  if (!asyncTimer)
  {
    asyncTimer = true;
    asyncSetTimer(asyncFlush, 0);
  }
}


function invokeResolver(resolver, promise) {
  function resolvePromise(value) {
    resolve(promise, value);
  }

  function rejectPromise(reason) {
    reject(promise, reason);
  }

  try {
    resolver(resolvePromise, rejectPromise);
  } catch(e) {
    rejectPromise(e);
  }
}

function invokeCallback(subscriber){
  var owner = subscriber.owner;
  var settled = owner.state_;
  var value = owner.data_;  
  var callback = subscriber[settled];
  var promise = subscriber.then;

  if (typeof callback === 'function')
  {
    settled = FULFILLED;
    try {
      value = callback(value);
    } catch(e) {
      reject(promise, e);
    }
  }

  if (!handleThenable(promise, value))
  {
    if (settled === FULFILLED)
      resolve(promise, value);

    if (settled === REJECTED)
      reject(promise, value);
  }
}

function handleThenable(promise, value) {
  var resolved;

  try {
    if (promise === value)
      throw new TypeError('A promises callback cannot return that same promise.');

    if (value && (typeof value === 'function' || typeof value === 'object'))
    {
      var then = value.then;  // then should be retrived only once

      if (typeof then === 'function')
      {
        then.call(value, function(val){
          if (!resolved)
          {
            resolved = true;

            if (value !== val)
              resolve(promise, val);
            else
              fulfill(promise, val);
          }
        }, function(reason){
          if (!resolved)
          {
            resolved = true;

            reject(promise, reason);
          }
        });

        return true;
      }
    }
  } catch (e) {
    if (!resolved)
      reject(promise, e);

    return true;
  }

  return false;
}

function resolve(promise, value){
  if (promise === value || !handleThenable(promise, value))
    fulfill(promise, value);
}

function fulfill(promise, value){
  if (promise.state_ === PENDING)
  {
    promise.state_ = SEALED;
    promise.data_ = value;

    asyncCall(publishFulfillment, promise);
  }
}

function reject(promise, reason){
  if (promise.state_ === PENDING)
  {
    promise.state_ = SEALED;
    promise.data_ = reason;

    asyncCall(publishRejection, promise);
  }
}

function publish(promise) {
  var callbacks = promise.then_;
  promise.then_ = undefined;

  for (var i = 0; i < callbacks.length; i++) {
    invokeCallback(callbacks[i]);
  }
}

function publishFulfillment(promise){
  promise.state_ = FULFILLED;
  publish(promise);
}

function publishRejection(promise){
  promise.state_ = REJECTED;
  publish(promise);
}

/**
* @class
*/
function Promise(resolver){
  if (typeof resolver !== 'function')
    throw new TypeError('Promise constructor takes a function argument');

  if (this instanceof Promise === false)
    throw new TypeError('Failed to construct \'Promise\': Please use the \'new\' operator, this object constructor cannot be called as a function.');

  this.then_ = [];

  invokeResolver(resolver, this);
}

Promise.prototype = {
  constructor: Promise,

  state_: PENDING,
  then_: null,
  data_: undefined,

  then: function(onFulfillment, onRejection){
    var subscriber = {
      owner: this,
      then: new this.constructor(NOOP),
      fulfilled: onFulfillment,
      rejected: onRejection
    };

    if (this.state_ === FULFILLED || this.state_ === REJECTED)
    {
      // already resolved, call callback async
      asyncCall(invokeCallback, subscriber);
    }
    else
    {
      // subscribe
      this.then_.push(subscriber);
    }

    return subscriber.then;
  },

  'catch': function(onRejection) {
    return this.then(null, onRejection);
  }
};

Promise.all = function(promises){
  var Class = this;

  if (!isArray(promises))
    throw new TypeError('You must pass an array to Promise.all().');

  return new Class(function(resolve, reject){
    var results = [];
    var remaining = 0;

    function resolver(index){
      remaining++;
      return function(value){
        results[index] = value;
        if (!--remaining)
          resolve(results);
      };
    }

    for (var i = 0, promise; i < promises.length; i++)
    {
      promise = promises[i];

      if (promise && typeof promise.then === 'function')
        promise.then(resolver(i), reject);
      else
        results[i] = promise;
    }

    if (!remaining)
      resolve(results);
  });
};

Promise.race = function(promises){
  var Class = this;

  if (!isArray(promises))
    throw new TypeError('You must pass an array to Promise.race().');

  return new Class(function(resolve, reject) {
    for (var i = 0, promise; i < promises.length; i++)
    {
      promise = promises[i];

      if (promise && typeof promise.then === 'function')
        promise.then(resolve, reject);
      else
        resolve(promise);
    }
  });
};

Promise.resolve = function(value){
  var Class = this;

  if (value && typeof value === 'object' && value.constructor === Class)
    return value;

  return new Class(function(resolve){
    resolve(value);
  });
};

Promise.reject = function(reason){
  var Class = this;

  return new Class(function(resolve, reject){
    reject(reason);
  });
};

})(typeof window != 'undefined' ? window : typeof global != 'undefined' ? global : typeof self != 'undefined' ? self : this);


/*!
Copyright (C) 2014-2015 by WebReflection

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/
(function(window, document, Object, REGISTER_ELEMENT){'use strict';

// in case it's there or already patched
if (REGISTER_ELEMENT in document) return;

// DO NOT USE THIS FILE DIRECTLY, IT WON'T WORK
// THIS IS A PROJECT BASED ON A BUILD SYSTEM
// THIS FILE IS JUST WRAPPED UP RESULTING IN
// build/document-register-element.js
// and its .max.js counter part

var
  // IE < 11 only + old WebKit for attributes + feature detection
  EXPANDO_UID = '__' + REGISTER_ELEMENT + (Math.random() * 10e4 >> 0),

  // shortcuts and costants
  ATTACHED = 'attached',
  DETACHED = 'detached',
  EXTENDS = 'extends',
  ADDITION = 'ADDITION',
  MODIFICATION = 'MODIFICATION',
  REMOVAL = 'REMOVAL',
  DOM_ATTR_MODIFIED = 'DOMAttrModified',
  DOM_CONTENT_LOADED = 'DOMContentLoaded',
  DOM_SUBTREE_MODIFIED = 'DOMSubtreeModified',
  PREFIX_TAG = '<',
  PREFIX_IS = '=',

  // valid and invalid node names
  validName = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/,
  invalidNames = [
    'ANNOTATION-XML',
    'COLOR-PROFILE',
    'FONT-FACE',
    'FONT-FACE-SRC',
    'FONT-FACE-URI',
    'FONT-FACE-FORMAT',
    'FONT-FACE-NAME',
    'MISSING-GLYPH'
  ],

  // registered types and their prototypes
  types = [],
  protos = [],

  // to query subnodes
  query = '',

  // html shortcut used to feature detect
  documentElement = document.documentElement,

  // ES5 inline helpers || basic patches
  indexOf = types.indexOf || function (v) {
    for(var i = this.length; i-- && this[i] !== v;){}
    return i;
  },

  // other helpers / shortcuts
  OP = Object.prototype,
  hOP = OP.hasOwnProperty,
  iPO = OP.isPrototypeOf,

  defineProperty = Object.defineProperty,
  gOPD = Object.getOwnPropertyDescriptor,
  gOPN = Object.getOwnPropertyNames,
  gPO = Object.getPrototypeOf,
  sPO = Object.setPrototypeOf,

  // jshint proto: true
  hasProto = !!Object.__proto__,

  // used to create unique instances
  create = Object.create || function Bridge(proto) {
    // silly broken polyfill probably ever used but short enough to work
    return proto ? ((Bridge.prototype = proto), new Bridge()) : this;
  },

  // will set the prototype if possible
  // or copy over all properties
  setPrototype = sPO || (
    hasProto ?
      function (o, p) {
        o.__proto__ = p;
        return o;
      } : (
    (gOPN && gOPD) ?
      (function(){
        function setProperties(o, p) {
          for (var
            key,
            names = gOPN(p),
            i = 0, length = names.length;
            i < length; i++
          ) {
            key = names[i];
            if (!hOP.call(o, key)) {
              defineProperty(o, key, gOPD(p, key));
            }
          }
        }
        return function (o, p) {
          do {
            setProperties(o, p);
          } while ((p = gPO(p)) && !iPO.call(p, o));
          return o;
        };
      }()) :
      function (o, p) {
        for (var key in p) {
          o[key] = p[key];
        }
        return o;
      }
  )),

  // DOM shortcuts and helpers, if any

  MutationObserver = window.MutationObserver ||
                     window.WebKitMutationObserver,

  HTMLElementPrototype = (
    window.HTMLElement ||
    window.Element ||
    window.Node
  ).prototype,

  IE8 = !iPO.call(HTMLElementPrototype, documentElement),

  isValidNode = IE8 ?
    function (node) {
      return node.nodeType === 1;
    } :
    function (node) {
      return iPO.call(HTMLElementPrototype, node);
    },

  targets = IE8 && [],

  cloneNode = HTMLElementPrototype.cloneNode,
  setAttribute = HTMLElementPrototype.setAttribute,
  removeAttribute = HTMLElementPrototype.removeAttribute,

  // replaced later on
  createElement = document.createElement,

  // shared observer for all attributes
  attributesObserver = MutationObserver && {
    attributes: true,
    characterData: true,
    attributeOldValue: true
  },

  // useful to detect only if there's no MutationObserver
  DOMAttrModified = MutationObserver || function(e) {
    doesNotSupportDOMAttrModified = false;
    documentElement.removeEventListener(
      DOM_ATTR_MODIFIED,
      DOMAttrModified
    );
  },

  // will both be used to make DOMNodeInserted asynchronous
  asapQueue,
  rAF = window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (fn) { setTimeout(fn, 10); },

  // internal flags
  setListener = false,
  doesNotSupportDOMAttrModified = true,
  dropDomContentLoaded = true,

  // needed for the innerHTML helper
  notFromInnerHTMLHelper = true,

  // optionally defined later on
  onSubtreeModified,
  callDOMAttrModified,
  getAttributesMirror,
  observer,

  // based on setting prototype capability
  // will check proto or the expando attribute
  // in order to setup the node once
  patchIfNotAlready,
  patch
;

if (sPO || hasProto) {
    patchIfNotAlready = function (node, proto) {
      if (!iPO.call(proto, node)) {
        setupNode(node, proto);
      }
    };
    patch = setupNode;
} else {
    patchIfNotAlready = function (node, proto) {
      if (!node[EXPANDO_UID]) {
        node[EXPANDO_UID] = Object(true);
        setupNode(node, proto);
      }
    };
    patch = patchIfNotAlready;
}
if (IE8) {
  doesNotSupportDOMAttrModified = false;
  (function (){
    var
      descriptor = gOPD(HTMLElementPrototype, 'addEventListener'),
      addEventListener = descriptor.value,
      patchedRemoveAttribute = function (name) {
        var e = new CustomEvent(DOM_ATTR_MODIFIED, {bubbles: true});
        e.attrName = name;
        e.prevValue = this.getAttribute(name);
        e.newValue = null;
        e[REMOVAL] = e.attrChange = 2;
        removeAttribute.call(this, name);
        this.dispatchEvent(e);
      },
      patchedSetAttribute = function (name, value) {
        var
          had = this.hasAttribute(name),
          old = had && this.getAttribute(name),
          e = new CustomEvent(DOM_ATTR_MODIFIED, {bubbles: true})
        ;
        setAttribute.call(this, name, value);
        e.attrName = name;
        e.prevValue = had ? old : null;
        e.newValue = value;
        if (had) {
          e[MODIFICATION] = e.attrChange = 1;
        } else {
          e[ADDITION] = e.attrChange = 0;
        }
        this.dispatchEvent(e);
      },
      onPropertyChange = function (e) {
        // jshint eqnull:true
        var
          node = e.currentTarget,
          superSecret = node[EXPANDO_UID],
          propertyName = e.propertyName,
          event
        ;
        if (superSecret.hasOwnProperty(propertyName)) {
          superSecret = superSecret[propertyName];
          event = new CustomEvent(DOM_ATTR_MODIFIED, {bubbles: true});
          event.attrName = superSecret.name;
          event.prevValue = superSecret.value || null;
          event.newValue = (superSecret.value = node[propertyName] || null);
          if (event.prevValue == null) {
            event[ADDITION] = event.attrChange = 0;
          } else {
            event[MODIFICATION] = event.attrChange = 1;
          }
          node.dispatchEvent(event);
        }
      }
    ;
    descriptor.value = function (type, handler, capture) {
      if (
        type === DOM_ATTR_MODIFIED &&
        this.attributeChangedCallback &&
        this.setAttribute !== patchedSetAttribute
      ) {
        this[EXPANDO_UID] = {
          className: {
            name: 'class',
            value: this.className
          }
        };
        this.setAttribute = patchedSetAttribute;
        this.removeAttribute = patchedRemoveAttribute;
        addEventListener.call(this, 'propertychange', onPropertyChange);
      }
      addEventListener.call(this, type, handler, capture);
    };
    defineProperty(HTMLElementPrototype, 'addEventListener', descriptor);
  }());
} else if (!MutationObserver) {
  documentElement.addEventListener(DOM_ATTR_MODIFIED, DOMAttrModified);
  documentElement.setAttribute(EXPANDO_UID, 1);
  documentElement.removeAttribute(EXPANDO_UID);
  if (doesNotSupportDOMAttrModified) {
    onSubtreeModified = function (e) {
      var
        node = this,
        oldAttributes,
        newAttributes,
        key
      ;
      if (node === e.target) {
        oldAttributes = node[EXPANDO_UID];
        node[EXPANDO_UID] = (newAttributes = getAttributesMirror(node));
        for (key in newAttributes) {
          if (!(key in oldAttributes)) {
            // attribute was added
            return callDOMAttrModified(
              0,
              node,
              key,
              oldAttributes[key],
              newAttributes[key],
              ADDITION
            );
          } else if (newAttributes[key] !== oldAttributes[key]) {
            // attribute was changed
            return callDOMAttrModified(
              1,
              node,
              key,
              oldAttributes[key],
              newAttributes[key],
              MODIFICATION
            );
          }
        }
        // checking if it has been removed
        for (key in oldAttributes) {
          if (!(key in newAttributes)) {
            // attribute removed
            return callDOMAttrModified(
              2,
              node,
              key,
              oldAttributes[key],
              newAttributes[key],
              REMOVAL
            );
          }
        }
      }
    };
    callDOMAttrModified = function (
      attrChange,
      currentTarget,
      attrName,
      prevValue,
      newValue,
      action
    ) {
      var e = {
        attrChange: attrChange,
        currentTarget: currentTarget,
        attrName: attrName,
        prevValue: prevValue,
        newValue: newValue
      };
      e[action] = attrChange;
      onDOMAttrModified(e);
    };
    getAttributesMirror = function (node) {
      for (var
        attr, name,
        result = {},
        attributes = node.attributes,
        i = 0, length = attributes.length;
        i < length; i++
      ) {
        attr = attributes[i];
        name = attr.name;
        if (name !== 'setAttribute') {
          result[name] = attr.value;
        }
      }
      return result;
    };
  }
}

function loopAndVerify(list, action) {
  for (var i = 0, length = list.length; i < length; i++) {
    verifyAndSetupAndAction(list[i], action);
  }
}

function loopAndSetup(list) {
  for (var i = 0, length = list.length, node; i < length; i++) {
    node = list[i];
    patch(node, protos[getTypeIndex(node)]);
  }
}

function executeAction(action) {
  return function (node) {
    if (isValidNode(node)) {
      verifyAndSetupAndAction(node, action);
      loopAndVerify(
        node.querySelectorAll(query),
        action
      );
    }
  };
}

function getTypeIndex(target) {
  var
    is = target.getAttribute('is'),
    nodeName = target.nodeName.toUpperCase(),
    i = indexOf.call(
      types,
      is ?
          PREFIX_IS + is.toUpperCase() :
          PREFIX_TAG + nodeName
    )
  ;
  return is && -1 < i && !isInQSA(nodeName, is) ? -1 : i;
}

function isInQSA(name, type) {
  return -1 < query.indexOf(name + '[is="' + type + '"]');
}

function onDOMAttrModified(e) {
  var
    node = e.currentTarget,
    attrChange = e.attrChange,
    attrName = e.attrName,
    target = e.target
  ;
  if (notFromInnerHTMLHelper &&
      (!target || target === node) &&
      node.attributeChangedCallback &&
      attrName !== 'style') {
    node.attributeChangedCallback(
      attrName,
      attrChange === e[ADDITION] ? null : e.prevValue,
      attrChange === e[REMOVAL] ? null : e.newValue
    );
  }
}

function onDOMNode(action) {
  var executor = executeAction(action);
  return function (e) {
    asapQueue.push(executor, e.target);
  };
}

function onReadyStateChange(e) {
  if (dropDomContentLoaded) {
    dropDomContentLoaded = false;
    e.currentTarget.removeEventListener(DOM_CONTENT_LOADED, onReadyStateChange);
  }
  loopAndVerify(
    (e.target || document).querySelectorAll(query),
    e.detail === DETACHED ? DETACHED : ATTACHED
  );
  if (IE8) purge();
}

function patchedSetAttribute(name, value) {
  // jshint validthis:true
  var self = this;
  setAttribute.call(self, name, value);
  onSubtreeModified.call(self, {target: self});
}

function setupNode(node, proto) {
  setPrototype(node, proto);
  if (observer) {
    observer.observe(node, attributesObserver);
  } else {
    if (doesNotSupportDOMAttrModified) {
      node.setAttribute = patchedSetAttribute;
      node[EXPANDO_UID] = getAttributesMirror(node);
      node.addEventListener(DOM_SUBTREE_MODIFIED, onSubtreeModified);
    }
    node.addEventListener(DOM_ATTR_MODIFIED, onDOMAttrModified);
  }
  if (node.createdCallback && notFromInnerHTMLHelper) {
    node.created = true;
    node.createdCallback();
    node.created = false;
  }
}

function purge() {
  for (var
    node,
    i = 0,
    length = targets.length;
    i < length; i++
  ) {
    node = targets[i];
    if (!documentElement.contains(node)) {
      targets.splice(i, 1);
      verifyAndSetupAndAction(node, DETACHED);
    }
  }
}

function verifyAndSetupAndAction(node, action) {
  var
    fn,
    i = getTypeIndex(node)
  ;
  if (-1 < i) {
    patchIfNotAlready(node, protos[i]);
    i = 0;
    if (action === ATTACHED && !node[ATTACHED]) {
      node[DETACHED] = false;
      node[ATTACHED] = true;
      i = 1;
      if (IE8 && indexOf.call(targets, node) < 0) {
        targets.push(node);
      }
    } else if (action === DETACHED && !node[DETACHED]) {
      node[ATTACHED] = false;
      node[DETACHED] = true;
      i = 1;
    }
    if (i && (fn = node[action + 'Callback'])) fn.call(node);
  }
}

// set as enumerable, writable and configurable
document[REGISTER_ELEMENT] = function registerElement(type, options) {
  upperType = type.toUpperCase();
  if (!setListener) {
    // only first time document.registerElement is used
    // we need to set this listener
    // setting it by default might slow down for no reason
    setListener = true;
    if (MutationObserver) {
      observer = (function(attached, detached){
        function checkEmAll(list, callback) {
          for (var i = 0, length = list.length; i < length; callback(list[i++])){}
        }
        return new MutationObserver(function (records) {
          for (var
            current, node,
            i = 0, length = records.length; i < length; i++
          ) {
            current = records[i];
            if (current.type === 'childList') {
              checkEmAll(current.addedNodes, attached);
              checkEmAll(current.removedNodes, detached);
            } else {
              node = current.target;
              if (notFromInnerHTMLHelper &&
                  node.attributeChangedCallback &&
                  current.attributeName !== 'style') {
                node.attributeChangedCallback(
                  current.attributeName,
                  current.oldValue,
                  node.getAttribute(current.attributeName)
                );
              }
            }
          }
        });
      }(executeAction(ATTACHED), executeAction(DETACHED)));
      observer.observe(
        document,
        {
          childList: true,
          subtree: true
        }
      );
    } else {
      asapQueue = [];
      rAF(function ASAP() {
        while (asapQueue.length) {
          asapQueue.shift().call(
            null, asapQueue.shift()
          );
        }
        rAF(ASAP);
      });
      document.addEventListener('DOMNodeInserted', onDOMNode(ATTACHED));
      document.addEventListener('DOMNodeRemoved', onDOMNode(DETACHED));
    }

    document.addEventListener(DOM_CONTENT_LOADED, onReadyStateChange);
    document.addEventListener('readystatechange', onReadyStateChange);

    document.createElement = function (localName, typeExtension) {
      var
        node = createElement.apply(document, arguments),
        name = '' + localName,
        i = indexOf.call(
          types,
          (typeExtension ? PREFIX_IS : PREFIX_TAG) +
          (typeExtension || name).toUpperCase()
        ),
        setup = -1 < i
      ;
      if (typeExtension) {
        node.setAttribute('is', typeExtension = typeExtension.toLowerCase());
        if (setup) {
          setup = isInQSA(name.toUpperCase(), typeExtension);
        }
      }
      notFromInnerHTMLHelper = !document.createElement.innerHTMLHelper;
      if (setup) patch(node, protos[i]);
      return node;
    };

    HTMLElementPrototype.cloneNode = function (deep) {
      var
        node = cloneNode.call(this, !!deep),
        i = getTypeIndex(node)
      ;
      if (-1 < i) patch(node, protos[i]);
      if (deep) loopAndSetup(node.querySelectorAll(query));
      return node;
    };
  }

  if (-2 < (
    indexOf.call(types, PREFIX_IS + upperType) +
    indexOf.call(types, PREFIX_TAG + upperType)
  )) {
    throw new Error('A ' + type + ' type is already registered');
  }

  if (!validName.test(upperType) || -1 < indexOf.call(invalidNames, upperType)) {
    throw new Error('The type ' + type + ' is invalid');
  }

  var
    constructor = function () {
      return extending ?
        document.createElement(nodeName, upperType) :
        document.createElement(nodeName);
    },
    opt = options || OP,
    extending = hOP.call(opt, EXTENDS),
    nodeName = extending ? options[EXTENDS].toUpperCase() : upperType,
    i = types.push((extending ? PREFIX_IS : PREFIX_TAG) + upperType) - 1,
    upperType
  ;

  query = query.concat(
    query.length ? ',' : '',
    extending ? nodeName + '[is="' + type.toLowerCase() + '"]' : nodeName
  );

  constructor.prototype = (
    protos[i] = hOP.call(opt, 'prototype') ?
      opt.prototype :
      create(HTMLElementPrototype)
  );

  loopAndVerify(
    document.querySelectorAll(query),
    ATTACHED
  );

  return constructor;
};

}(window, document, Object, 'registerElement'));

var define,require,esl;!function(n){function e(n){p(n,N)||(_[n]=1)}function r(n,e){function r(n){0===n.indexOf(".")&&i.push(n)}var i=[];if("string"==typeof n?r(n):D(n,function(n){r(n)}),i.length>0)throw new Error("[REQUIRE_FATAL]Relative ID is not allowed in global require: "+i.join(", "));var o=P.waitSeconds;return o&&n instanceof Array&&(T&&clearTimeout(T),T=setTimeout(t,1e3*o)),H(n,e)}function t(){function n(a,u){if(!o[a]&&!p(a,N)){o[a]=1,p(a,L)||t[a]||(t[a]=1,e.push(a));var f=F[a];f?u&&(t[a]||(t[a]=1,e.push(a)),D(f.depMs,function(e){n(e.absId,e.hard)})):i[a]||(i[a]=1,r.push(a))}}var e=[],r=[],t={},i={},o={};for(var a in _)n(a,1);if(e.length||r.length)throw new Error("[MODULE_TIMEOUT]Hang( "+(e.join(", ")||"none")+" ) Miss( "+(r.join(", ")||"none")+" )")}function i(n){D(Q,function(e){u(n,e.deps,e.factory)}),Q.length=0}function o(n,e,r){if(null==r&&(null==e?(r=n,n=null):(r=e,e=null,n instanceof Array&&(e=n,n=null))),null!=r){var t=window.opera;if(!n&&document.attachEvent&&(!t||"[object Opera]"!==t.toString())){var i=O();n=i&&i.getAttribute("data-require-id")}n?u(n,e,r):Q[0]={deps:e,factory:r}}}function a(){var n=P.config[this.id];return n&&"object"==typeof n?n:{}}function u(n,e,r){F[n]||(F[n]={id:n,depsDec:e,deps:e||["require","exports","module"],factoryDeps:[],factory:r,exports:{},config:a,state:z,require:M(n),depMs:[],depMkv:{},depRs:[]})}function f(n){var e=F[n];if(e&&!p(n,B)){var r=e.deps,t=e.factory,i=0;"function"==typeof t&&(i=Math.min(t.length,r.length),!e.depsDec&&t.toString().replace(/(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/gm,"").replace(/require\(\s*(['"])([^'"]+)\1\s*\)/g,function(n,e,t){r.push(t)}));var o=[],a=[];D(r,function(r,t){var u,f,c=S(r),s=q(c.mod,n);s&&!C[s]?(c.res&&(f={id:r,mod:s,res:c.res},a.push(r),e.depRs.push(f)),u=e.depMkv[s],u||(u={id:c.mod,absId:s,hard:i>t},e.depMs.push(u),e.depMkv[s]=u,o.push(s))):u={absId:s},i>t&&e.factoryDeps.push(f||u)}),e.state=B,l(n),m(o),a.length&&e.require(a,function(){D(e.depRs,function(e){e.absId||(e.absId=q(e.id,n))}),c()})}}function c(){for(var n in _)f(n),s(n),d(n)}function s(n){function e(n){if(f(n),!p(n,B))return!1;if(p(n,L)||r[n])return!0;r[n]=1;var t=F[n],i=!0;return D(t.depMs,function(n){return i=e(n.absId)}),i&&D(t.depRs,function(n){return i=!!n.absId}),i&&!p(n,L)&&(t.state=L),i}var r={};e(n)}function l(e){function r(){if(!t&&i.state===L){t=1;var r=1;if(D(i.factoryDeps,function(n){var e=n.absId;return C[e]?void 0:(d(e),r=p(e,N))}),r){try{var o=i.factory,a="function"==typeof o?o.apply(n,v(i.factoryDeps,{require:i.require,exports:i.exports,module:i})):o;null!=a&&(i.exports=a),i.invokeFactory=null}catch(u){if(/^\[MODULE_MISS\]"([^"]+)/.test(u.message)){var f=i.depMkv[RegExp.$1];return f&&(f.hard=1),void(t=0)}throw u}g(e)}}}var t,i=F[e];i.invokeFactory=r}function p(n,e){return F[n]&&F[n].state>=e}function d(n){var e=F[n];e&&e.invokeFactory&&e.invokeFactory()}function v(n,e){var r=[];return D(n,function(n,t){"object"==typeof n&&(n=n.absId),r[t]=e[n]||F[n].exports}),r}function h(n,e){if(p(n,N))return void e();var r=G[n];r||(r=G[n]=[]),r.push(e)}function g(n){var e=F[n];e.state=N,delete _[n];for(var r=G[n]||[],t=r.length;t--;)r[t]();r.length=0,G[n]=null}function m(e,r,t){function i(){if("function"==typeof r&&!o){var t=1;D(e,function(n){return C[n]?void 0:t=!!p(n,N)}),t&&(o=1,r.apply(n,v(e,C)))}}var o=0;D(e,function(n){C[n]||p(n,N)||(h(n,i),(n.indexOf("!")>0?b:y)(n,t))}),i()}function y(e){function r(){var n=X[e];R(n||e,t)}function t(){if(a){var r;"function"==typeof a.init&&(r=a.init.apply(n,v(u,C))),null==r&&a.exports&&(r=n,D(a.exports.split("."),function(n){return r=r[n],!!r})),o(e,u,r||{})}else i(e);c()}if(!J[e]&&!F[e]){J[e]=1;var a=P.shim[e];a instanceof Array&&(P.shim[e]=a={deps:a});var u=a&&(a.deps||[]);u?(D(u,function(n){P.shim[n]||(P.shim[n]={})}),H(u,r)):r()}}function b(n,e){function r(e){f.exports=e||!0,g(n)}function t(t){var i=e?F[e].require:H;t.load(u.res,i,r,a.call({id:n}))}if(!F[n]){var o=X[n];if(o)return void y(o);var u=S(n),f={id:n,state:B};F[n]=f,r.fromText=function(n,e){new Function(e)(),i(n)},t(H(u.mod))}}function x(n,e){var r=U(n,1,e);return r.sort($),r}function k(){function n(n){X[A(n)]=e}P.baseUrl=P.baseUrl.replace(/\/$/,"")+"/",K=x(P.paths),W=x(P.map,1),D(W,function(n){n.v=x(n.v)}),V=[],D(P.packages,function(n){var e=n;"string"==typeof n&&(e={name:n.split("/")[0],location:n,main:"main"}),e.location=e.location||e.name,e.main=(e.main||"main").replace(/\.js$/i,""),e.reg=j(e.name),V.push(e)}),V.sort($),Y=x(P.urlArgs,1),X={};for(var e in P.bundles)D(P.bundles[e],n)}function E(n,e,r){D(e,function(e){return e.reg.test(n)?(r(e.v,e.k,e),!1):void 0})}function w(n,e){var r=/(\.[a-z0-9]+)$/i,t=/(\?[^#]*)$/,i="",o=n,a="";t.test(n)&&(a=RegExp.$1,n=n.replace(t,"")),r.test(n)&&(i=RegExp.$1,o=n.replace(r,"")),null!=e&&(o=q(o,e));var u,f=o;return E(o,K,function(n,e){f=f.replace(e,n),u=1}),u||E(o,V,function(n,e,r){f=f.replace(r.name,r.location)}),/^([a-z]{2,10}:\/)?\//i.test(f)||(f=P.baseUrl+f),f+=i+a,E(o,Y,function(n){f+=(f.indexOf("?")>0?"&":"?")+n}),f}function M(n){function r(r,i){if("string"==typeof r){if(!t[r]){var o=q(r,n);if(d(o),!p(o,N))throw new Error('[MODULE_MISS]"'+o+'" is not exists!');t[r]=F[o].exports}return t[r]}if(r instanceof Array){var a=[],u=[];D(r,function(r,t){var i=S(r),o=q(i.mod,n),f=i.res,c=o;if(f){var s=o+"!"+f;0!==f.indexOf(".")&&X[s]?o=c=s:c=null}u[t]=c,e(o),a.push(o)}),m(a,function(){D(u,function(t,i){null==t&&(t=u[i]=q(r[i],n),e(t))}),m(u,i,n),c()},n),c()}}var t={};return r.toUrl=function(e){return w(e,n||"")},r}function q(n,e){if(!n)return"";e=e||"";var r=S(n);if(!r)return n;var t=r.res,i=I(r.mod,e);if(E(e,W,function(n){E(i,n,function(n,e){i=i.replace(e,n)})}),i=A(i),t){var o=p(i,N)&&H(i);t=o&&o.normalize?o.normalize(t,function(n){return q(n,e)}):q(t,e),i+="!"+t}return i}function A(n){return D(V,function(e){var r=e.name;return r===n?(n=r+"/"+e.main,!1):void 0}),n}function I(n,e){if(0===n.indexOf(".")){var r=e.split("/"),t=n.split("/"),i=r.length-1,o=t.length,a=0,u=0;n:for(var f=0;o>f;f++)switch(t[f]){case"..":if(!(i>a))break n;a++,u++;break;case".":u++;break;default:break n}return r.length=i-a,t=t.slice(u),r.concat(t).join("/")}return n}function S(n){var e=n.split("!");return e[0]?{mod:e[0],res:e[1]}:void 0}function U(n,e,r){var t=[];for(var i in n)if(n.hasOwnProperty(i)){var o={k:i,v:n[i]};t.push(o),e&&(o.reg="*"===i&&r?/^/:j(i))}return t}function O(){if(Z)return Z;if(ne&&"interactive"===ne.readyState)return ne;for(var n=document.getElementsByTagName("script"),e=n.length;e--;){var r=n[e];if("interactive"===r.readyState)return ne=r,r}}function R(n,e){function r(){var n=t.readyState;("undefined"==typeof n||/^(loaded|complete)$/.test(n))&&(t.onload=t.onreadystatechange=null,t=null,e())}var t=document.createElement("script");t.setAttribute("data-require-id",n),t.src=w(n+".js"),t.async=!0,t.readyState?t.onreadystatechange=r:t.onload=r,Z=t,re?ee.insertBefore(t,re):ee.appendChild(t),Z=null}function j(n){return new RegExp("^"+n+"(/|$)")}function D(n,e){if(n instanceof Array)for(var r=0,t=n.length;t>r&&e(n[r],r)!==!1;r++);}function $(n,e){var r=n.k||n.name,t=e.k||e.name;return"*"===t?-1:"*"===r?1:t.length-r.length}var T,F={},z=1,B=2,L=3,N=4,_={},C={require:r,exports:1,module:1},H=M(),P={baseUrl:"./",paths:{},config:{},map:{},packages:[],shim:{},waitSeconds:0,bundles:{},urlArgs:{}};r.version="2.0.6",r.loader="esl",r.toUrl=H.toUrl;var Q=[];o.amd={};var G={},J={};r.config=function(n){if(n){for(var e in P){var r=n[e],t=P[e];if(r)if("urlArgs"===e&&"string"==typeof r)P.urlArgs["*"]=r;else if(t instanceof Array)t.push.apply(t,r);else if("object"==typeof t)for(var i in r)t[i]=r[i];else P[e]=r}k()}},k();var K,V,W,X,Y,Z,ne,ee=document.getElementsByTagName("head")[0],re=document.getElementsByTagName("base")[0];re&&(ee=re.parentNode),define||(define=o,require||(require=r),esl=r)}(this);

// ======================
// deps/zepto.js
// ======================


/* Zepto v1.2.0 - zepto event ajax ie form fx fx_methods - zeptojs.com/license */
(function (global, factory) {
    if (typeof define === 'function' && define.amd)
        define('zepto', [], function () {
            return factory(global);
        });
    else
        factory(global);
}(this, function (window) {
    var Zepto = function () {
        var undefined, key, $, classList, emptyArray = [], concat = emptyArray.concat, filter = emptyArray.filter, slice = emptyArray.slice, document = window.document, elementDisplay = {}, classCache = {}, cssNumber = {
                'column-count': 1,
                'columns': 1,
                'font-weight': 1,
                'line-height': 1,
                'opacity': 1,
                'z-index': 1,
                'zoom': 1
            }, fragmentRE = /^\s*<(\w+|!)[^>]*>/, singleTagRE = /^<(\w+)\s*\/?>(?:<\/\1>|)$/, tagExpanderRE = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi, rootNodeRE = /^(?:body|html)$/i, capitalRE = /([A-Z])/g,
            // special attributes that should be get/set via method calls
            methodAttributes = [
                'val',
                'css',
                'html',
                'text',
                'data',
                'width',
                'height',
                'offset'
            ], adjacencyOperators = [
                'after',
                'prepend',
                'before',
                'append'
            ], table = document.createElement('table'), tableRow = document.createElement('tr'), containers = {
                'tr': document.createElement('tbody'),
                'tbody': table,
                'thead': table,
                'tfoot': table,
                'td': tableRow,
                'th': tableRow,
                '*': document.createElement('div')
            }, readyRE = /complete|loaded|interactive/, simpleSelectorRE = /^[\w-]*$/, class2type = {}, toString = class2type.toString, zepto = {}, camelize, uniq, tempParent = document.createElement('div'), propMap = {
                'tabindex': 'tabIndex',
                'readonly': 'readOnly',
                'for': 'htmlFor',
                'class': 'className',
                'maxlength': 'maxLength',
                'cellspacing': 'cellSpacing',
                'cellpadding': 'cellPadding',
                'rowspan': 'rowSpan',
                'colspan': 'colSpan',
                'usemap': 'useMap',
                'frameborder': 'frameBorder',
                'contenteditable': 'contentEditable'
            }, isArray = Array.isArray || function (object) {
                return object instanceof Array;
            };
        zepto.matches = function (element, selector) {
            if (!selector || !element || element.nodeType !== 1)
                return false;
            var matchesSelector = element.matches || element.webkitMatchesSelector || element.mozMatchesSelector || element.oMatchesSelector || element.matchesSelector;
            if (matchesSelector)
                return matchesSelector.call(element, selector);
            // fall back to performing a selector:
            var match, parent = element.parentNode, temp = !parent;
            if (temp)
                (parent = tempParent).appendChild(element);
            match = ~zepto.qsa(parent, selector).indexOf(element);
            temp && tempParent.removeChild(element);
            return match;
        };
        function type(obj) {
            return obj == null ? String(obj) : class2type[toString.call(obj)] || 'object';
        }
        function isFunction(value) {
            return type(value) == 'function';
        }
        function isWindow(obj) {
            return obj != null && obj == obj.window;
        }
        function isDocument(obj) {
            return obj != null && obj.nodeType == obj.DOCUMENT_NODE;
        }
        function isObject(obj) {
            return type(obj) == 'object';
        }
        function isPlainObject(obj) {
            return isObject(obj) && !isWindow(obj) && Object.getPrototypeOf(obj) == Object.prototype;
        }
        function likeArray(obj) {
            var length = !!obj && 'length' in obj && obj.length, type = $.type(obj);
            return 'function' != type && !isWindow(obj) && ('array' == type || length === 0 || typeof length == 'number' && length > 0 && length - 1 in obj);
        }
        function compact(array) {
            return filter.call(array, function (item) {
                return item != null;
            });
        }
        function flatten(array) {
            return array.length > 0 ? $.fn.concat.apply([], array) : array;
        }
        camelize = function (str) {
            return str.replace(/-+(.)?/g, function (match, chr) {
                return chr ? chr.toUpperCase() : '';
            });
        };
        function dasherize(str) {
            return str.replace(/::/g, '/').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/([a-z\d])([A-Z])/g, '$1_$2').replace(/_/g, '-').toLowerCase();
        }
        uniq = function (array) {
            return filter.call(array, function (item, idx) {
                return array.indexOf(item) == idx;
            });
        };
        function classRE(name) {
            return name in classCache ? classCache[name] : classCache[name] = new RegExp('(^|\\s)' + name + '(\\s|$)');
        }
        function maybeAddPx(name, value) {
            return typeof value == 'number' && !cssNumber[dasherize(name)] ? value + 'px' : value;
        }
        function defaultDisplay(nodeName) {
            var element, display;
            if (!elementDisplay[nodeName]) {
                element = document.createElement(nodeName);
                document.body.appendChild(element);
                display = getComputedStyle(element, '').getPropertyValue('display');
                element.parentNode.removeChild(element);
                display == 'none' && (display = 'block');
                elementDisplay[nodeName] = display;
            }
            return elementDisplay[nodeName];
        }
        function children(element) {
            return 'children' in element ? slice.call(element.children) : $.map(element.childNodes, function (node) {
                if (node.nodeType == 1)
                    return node;
            });
        }
        function Z(dom, selector) {
            var i, len = dom ? dom.length : 0;
            for (i = 0; i < len; i++)
                this[i] = dom[i];
            this.length = len;
            this.selector = selector || '';
        }
        // `$.zepto.fragment` takes a html string and an optional tag name
        // to generate DOM nodes from the given html string.
        // The generated DOM nodes are returned as an array.
        // This function can be overridden in plugins for example to make
        // it compatible with browsers that don't support the DOM fully.
        zepto.fragment = function (html, name, properties) {
            var dom, nodes, container;
            // A special case optimization for a single tag
            if (singleTagRE.test(html))
                dom = $(document.createElement(RegExp.$1));
            if (!dom) {
                if (html.replace)
                    html = html.replace(tagExpanderRE, '<$1></$2>');
                if (name === undefined)
                    name = fragmentRE.test(html) && RegExp.$1;
                if (!(name in containers))
                    name = '*';
                container = containers[name];
                container.innerHTML = '' + html;
                dom = $.each(slice.call(container.childNodes), function () {
                    container.removeChild(this);
                });
            }
            if (isPlainObject(properties)) {
                nodes = $(dom);
                $.each(properties, function (key, value) {
                    if (methodAttributes.indexOf(key) > -1)
                        nodes[key](value);
                    else
                        nodes.attr(key, value);
                });
            }
            return dom;
        };
        // `$.zepto.Z` swaps out the prototype of the given `dom` array
        // of nodes with `$.fn` and thus supplying all the Zepto functions
        // to the array. This method can be overridden in plugins.
        zepto.Z = function (dom, selector) {
            return new Z(dom, selector);
        };
        // `$.zepto.isZ` should return `true` if the given object is a Zepto
        // collection. This method can be overridden in plugins.
        zepto.isZ = function (object) {
            return object instanceof zepto.Z;
        };
        // `$.zepto.init` is Zepto's counterpart to jQuery's `$.fn.init` and
        // takes a CSS selector and an optional context (and handles various
        // special cases).
        // This method can be overridden in plugins.
        zepto.init = function (selector, context) {
            var dom;
            // If nothing given, return an empty Zepto collection
            if (!selector)
                return zepto.Z()    // Optimize for string selectors
;
            else if (typeof selector == 'string') {
                selector = selector.trim();
                // If it's a html fragment, create nodes from it
                // Note: In both Chrome 21 and Firefox 15, DOM error 12
                // is thrown if the fragment doesn't begin with <
                if (selector[0] == '<' && fragmentRE.test(selector))
                    dom = zepto.fragment(selector, RegExp.$1, context), selector = null    // If there's a context, create a collection on that context first, and select
                            // nodes from there
;
                else if (context !== undefined)
                    return $(context).find(selector)    // If it's a CSS selector, use it to select nodes.
;
                else
                    dom = zepto.qsa(document, selector);
            }    // If a function is given, call it when the DOM is ready
            else if (isFunction(selector))
                return $(document).ready(selector)    // If a Zepto collection is given, just return it
;
            else if (zepto.isZ(selector))
                return selector;
            else {
                // normalize array if an array of nodes is given
                if (isArray(selector))
                    dom = compact(selector)    // Wrap DOM nodes.
;
                else if (isObject(selector))
                    dom = [selector], selector = null    // If it's a html fragment, create nodes from it
;
                else if (fragmentRE.test(selector))
                    dom = zepto.fragment(selector.trim(), RegExp.$1, context), selector = null    // If there's a context, create a collection on that context first, and select
                            // nodes from there
;
                else if (context !== undefined)
                    return $(context).find(selector)    // And last but no least, if it's a CSS selector, use it to select nodes.
;
                else
                    dom = zepto.qsa(document, selector);
            }
            // create a new Zepto collection from the nodes found
            return zepto.Z(dom, selector);
        };
        // `$` will be the base `Zepto` object. When calling this
        // function just call `$.zepto.init, which makes the implementation
        // details of selecting nodes and creating Zepto collections
        // patchable in plugins.
        $ = function (selector, context) {
            return zepto.init(selector, context);
        };
        function extend(target, source, deep) {
            for (key in source)
                if (deep && (isPlainObject(source[key]) || isArray(source[key]))) {
                    if (isPlainObject(source[key]) && !isPlainObject(target[key]))
                        target[key] = {};
                    if (isArray(source[key]) && !isArray(target[key]))
                        target[key] = [];
                    extend(target[key], source[key], deep);
                } else if (source[key] !== undefined)
                    target[key] = source[key];
        }
        // Copy all but undefined properties from one or more
        // objects to the `target` object.
        $.extend = function (target) {
            var deep, args = slice.call(arguments, 1);
            if (typeof target == 'boolean') {
                deep = target;
                target = args.shift();
            }
            args.forEach(function (arg) {
                extend(target, arg, deep);
            });
            return target;
        };
        // `$.zepto.qsa` is Zepto's CSS selector implementation which
        // uses `document.querySelectorAll` and optimizes for some special cases, like `#id`.
        // This method can be overridden in plugins.
        zepto.qsa = function (element, selector) {
            var found, maybeID = selector[0] == '#', maybeClass = !maybeID && selector[0] == '.', nameOnly = maybeID || maybeClass ? selector.slice(1) : selector,
                // Ensure that a 1 char tag name still gets checked
                isSimple = simpleSelectorRE.test(nameOnly);
            return element.getElementById && isSimple && maybeID ? (found = element.getElementById(nameOnly)) ? [found] : [] : element.nodeType !== 1 && element.nodeType !== 9 && element.nodeType !== 11 ? [] : slice.call(isSimple && !maybeID && element.getElementsByClassName ? // DocumentFragment doesn't have getElementsByClassName/TagName
            maybeClass ? element.getElementsByClassName(nameOnly) : // If it's simple, it could be a class
            element.getElementsByTagName(selector) : // Or a tag
            element.querySelectorAll(selector)    // Or it's not simple, and we need to query all
);
        };
        function filtered(nodes, selector) {
            return selector == null ? $(nodes) : $(nodes).filter(selector);
        }
        $.contains = document.documentElement.contains ? function (parent, node) {
            return parent !== node && parent.contains(node);
        } : function (parent, node) {
            while (node && (node = node.parentNode))
                if (node === parent)
                    return true;
            return false;
        };
        function funcArg(context, arg, idx, payload) {
            return isFunction(arg) ? arg.call(context, idx, payload) : arg;
        }
        function setAttribute(node, name, value) {
            value == null ? node.removeAttribute(name) : node.setAttribute(name, value);
        }
        // access className property while respecting SVGAnimatedString
        function className(node, value) {
            var klass = node.className || '', svg = klass && klass.baseVal !== undefined;
            if (value === undefined)
                return svg ? klass.baseVal : klass;
            svg ? klass.baseVal = value : node.className = value;
        }
        // "true"  => true
        // "false" => false
        // "null"  => null
        // "42"    => 42
        // "42.5"  => 42.5
        // "08"    => "08"
        // JSON    => parse if valid
        // String  => self
        function deserializeValue(value) {
            try {
                return value ? value == 'true' || (value == 'false' ? false : value == 'null' ? null : +value + '' == value ? +value : /^[\[\{]/.test(value) ? $.parseJSON(value) : value) : value;
            } catch (e) {
                return value;
            }
        }
        $.type = type;
        $.isFunction = isFunction;
        $.isWindow = isWindow;
        $.isArray = isArray;
        $.isPlainObject = isPlainObject;
        $.isEmptyObject = function (obj) {
            var name;
            for (name in obj)
                return false;
            return true;
        };
        $.isNumeric = function (val) {
            var num = Number(val), type = typeof val;
            return val != null && type != 'boolean' && (type != 'string' || val.length) && !isNaN(num) && isFinite(num) || false;
        };
        $.inArray = function (elem, array, i) {
            return emptyArray.indexOf.call(array, elem, i);
        };
        $.camelCase = camelize;
        $.trim = function (str) {
            return str == null ? '' : String.prototype.trim.call(str);
        };
        // plugin compatibility
        $.uuid = 0;
        $.support = {};
        $.expr = {};
        $.noop = function () {
        };
        $.map = function (elements, callback) {
            var value, values = [], i, key;
            if (likeArray(elements))
                for (i = 0; i < elements.length; i++) {
                    value = callback(elements[i], i);
                    if (value != null)
                        values.push(value);
                }
            else
                for (key in elements) {
                    value = callback(elements[key], key);
                    if (value != null)
                        values.push(value);
                }
            return flatten(values);
        };
        $.each = function (elements, callback) {
            var i, key;
            if (likeArray(elements)) {
                for (i = 0; i < elements.length; i++)
                    if (callback.call(elements[i], i, elements[i]) === false)
                        return elements;
            } else {
                for (key in elements)
                    if (callback.call(elements[key], key, elements[key]) === false)
                        return elements;
            }
            return elements;
        };
        $.grep = function (elements, callback) {
            return filter.call(elements, callback);
        };
        if (window.JSON)
            $.parseJSON = JSON.parse;
        // Populate the class2type map
        $.each('Boolean Number String Function Array Date RegExp Object Error'.split(' '), function (i, name) {
            class2type['[object ' + name + ']'] = name.toLowerCase();
        });
        // Define methods that will be available on all
        // Zepto collections
        $.fn = {
            constructor: zepto.Z,
            length: 0,
            // Because a collection acts like an array
            // copy over these useful array functions.
            forEach: emptyArray.forEach,
            reduce: emptyArray.reduce,
            push: emptyArray.push,
            sort: emptyArray.sort,
            splice: emptyArray.splice,
            indexOf: emptyArray.indexOf,
            concat: function () {
                var i, value, args = [];
                for (i = 0; i < arguments.length; i++) {
                    value = arguments[i];
                    args[i] = zepto.isZ(value) ? value.toArray() : value;
                }
                return concat.apply(zepto.isZ(this) ? this.toArray() : this, args);
            },
            // `map` and `slice` in the jQuery API work differently
            // from their array counterparts
            map: function (fn) {
                return $($.map(this, function (el, i) {
                    return fn.call(el, i, el);
                }));
            },
            slice: function () {
                return $(slice.apply(this, arguments));
            },
            ready: function (callback) {
                // need to check if document.body exists for IE as that browser reports
                // document ready when it hasn't yet created the body element
                if (readyRE.test(document.readyState) && document.body)
                    callback($);
                else
                    document.addEventListener('DOMContentLoaded', function () {
                        callback($);
                    }, false);
                return this;
            },
            get: function (idx) {
                return idx === undefined ? slice.call(this) : this[idx >= 0 ? idx : idx + this.length];
            },
            toArray: function () {
                return this.get();
            },
            size: function () {
                return this.length;
            },
            remove: function () {
                return this.each(function () {
                    if (this.parentNode != null)
                        this.parentNode.removeChild(this);
                });
            },
            each: function (callback) {
                emptyArray.every.call(this, function (el, idx) {
                    return callback.call(el, idx, el) !== false;
                });
                return this;
            },
            filter: function (selector) {
                if (isFunction(selector))
                    return this.not(this.not(selector));
                return $(filter.call(this, function (element) {
                    return zepto.matches(element, selector);
                }));
            },
            add: function (selector, context) {
                return $(uniq(this.concat($(selector, context))));
            },
            is: function (selector) {
                return this.length > 0 && zepto.matches(this[0], selector);
            },
            not: function (selector) {
                var nodes = [];
                if (isFunction(selector) && selector.call !== undefined)
                    this.each(function (idx) {
                        if (!selector.call(this, idx))
                            nodes.push(this);
                    });
                else {
                    var excludes = typeof selector == 'string' ? this.filter(selector) : likeArray(selector) && isFunction(selector.item) ? slice.call(selector) : $(selector);
                    this.forEach(function (el) {
                        if (excludes.indexOf(el) < 0)
                            nodes.push(el);
                    });
                }
                return $(nodes);
            },
            has: function (selector) {
                return this.filter(function () {
                    return isObject(selector) ? $.contains(this, selector) : $(this).find(selector).size();
                });
            },
            eq: function (idx) {
                return idx === -1 ? this.slice(idx) : this.slice(idx, +idx + 1);
            },
            first: function () {
                var el = this[0];
                return el && !isObject(el) ? el : $(el);
            },
            last: function () {
                var el = this[this.length - 1];
                return el && !isObject(el) ? el : $(el);
            },
            find: function (selector) {
                var result, $this = this;
                if (!selector)
                    result = $();
                else if (typeof selector == 'object')
                    result = $(selector).filter(function () {
                        var node = this;
                        return emptyArray.some.call($this, function (parent) {
                            return $.contains(parent, node);
                        });
                    });
                else if (this.length == 1)
                    result = $(zepto.qsa(this[0], selector));
                else
                    result = this.map(function () {
                        return zepto.qsa(this, selector);
                    });
                return result;
            },
            closest: function (selector, context) {
                var nodes = [], collection = typeof selector == 'object' && $(selector);
                this.each(function (_, node) {
                    while (node && !(collection ? collection.indexOf(node) >= 0 : zepto.matches(node, selector)))
                        node = node !== context && !isDocument(node) && node.parentNode;
                    if (node && nodes.indexOf(node) < 0)
                        nodes.push(node);
                });
                return $(nodes);
            },
            parents: function (selector) {
                var ancestors = [], nodes = this;
                while (nodes.length > 0)
                    nodes = $.map(nodes, function (node) {
                        if ((node = node.parentNode) && !isDocument(node) && ancestors.indexOf(node) < 0) {
                            ancestors.push(node);
                            return node;
                        }
                    });
                return filtered(ancestors, selector);
            },
            parent: function (selector) {
                return filtered(uniq(this.pluck('parentNode')), selector);
            },
            children: function (selector) {
                return filtered(this.map(function () {
                    return children(this);
                }), selector);
            },
            contents: function () {
                return this.map(function () {
                    return this.contentDocument || slice.call(this.childNodes);
                });
            },
            siblings: function (selector) {
                return filtered(this.map(function (i, el) {
                    return filter.call(children(el.parentNode), function (child) {
                        return child !== el;
                    });
                }), selector);
            },
            empty: function () {
                return this.each(function () {
                    this.innerHTML = '';
                });
            },
            // `pluck` is borrowed from Prototype.js
            pluck: function (property) {
                return $.map(this, function (el) {
                    return el[property];
                });
            },
            show: function () {
                return this.each(function () {
                    this.style.display == 'none' && (this.style.display = '');
                    if (getComputedStyle(this, '').getPropertyValue('display') == 'none')
                        this.style.display = defaultDisplay(this.nodeName);
                });
            },
            replaceWith: function (newContent) {
                return this.before(newContent).remove();
            },
            wrap: function (structure) {
                var func = isFunction(structure);
                if (this[0] && !func)
                    var dom = $(structure).get(0), clone = dom.parentNode || this.length > 1;
                return this.each(function (index) {
                    $(this).wrapAll(func ? structure.call(this, index) : clone ? dom.cloneNode(true) : dom);
                });
            },
            wrapAll: function (structure) {
                if (this[0]) {
                    $(this[0]).before(structure = $(structure));
                    var children;
                    // drill down to the inmost element
                    while ((children = structure.children()).length)
                        structure = children.first();
                    $(structure).append(this);
                }
                return this;
            },
            wrapInner: function (structure) {
                var func = isFunction(structure);
                return this.each(function (index) {
                    var self = $(this), contents = self.contents(), dom = func ? structure.call(this, index) : structure;
                    contents.length ? contents.wrapAll(dom) : self.append(dom);
                });
            },
            unwrap: function () {
                this.parent().each(function () {
                    $(this).replaceWith($(this).children());
                });
                return this;
            },
            clone: function () {
                return this.map(function () {
                    return this.cloneNode(true);
                });
            },
            hide: function () {
                return this.css('display', 'none');
            },
            toggle: function (setting) {
                return this.each(function () {
                    var el = $(this);
                    (setting === undefined ? el.css('display') == 'none' : setting) ? el.show() : el.hide();
                });
            },
            prev: function (selector) {
                return $(this.pluck('previousElementSibling')).filter(selector || '*');
            },
            next: function (selector) {
                return $(this.pluck('nextElementSibling')).filter(selector || '*');
            },
            html: function (html) {
                return 0 in arguments ? this.each(function (idx) {
                    var originHtml = this.innerHTML;
                    $(this).empty().append(funcArg(this, html, idx, originHtml));
                }) : 0 in this ? this[0].innerHTML : null;
            },
            text: function (text) {
                return 0 in arguments ? this.each(function (idx) {
                    var newText = funcArg(this, text, idx, this.textContent);
                    this.textContent = newText == null ? '' : '' + newText;
                }) : 0 in this ? this.pluck('textContent').join('') : null;
            },
            attr: function (name, value) {
                var result;
                return typeof name == 'string' && !(1 in arguments) ? 0 in this && this[0].nodeType == 1 && (result = this[0].getAttribute(name)) != null ? result : undefined : this.each(function (idx) {
                    if (this.nodeType !== 1)
                        return;
                    if (isObject(name))
                        for (key in name)
                            setAttribute(this, key, name[key]);
                    else
                        setAttribute(this, name, funcArg(this, value, idx, this.getAttribute(name)));
                });
            },
            removeAttr: function (name) {
                return this.each(function () {
                    this.nodeType === 1 && name.split(' ').forEach(function (attribute) {
                        setAttribute(this, attribute);
                    }, this);
                });
            },
            prop: function (name, value) {
                name = propMap[name] || name;
                return 1 in arguments ? this.each(function (idx) {
                    this[name] = funcArg(this, value, idx, this[name]);
                }) : this[0] && this[0][name];
            },
            removeProp: function (name) {
                name = propMap[name] || name;
                return this.each(function () {
                    delete this[name];
                });
            },
            data: function (name, value) {
                var attrName = 'data-' + name.replace(capitalRE, '-$1').toLowerCase();
                var data = 1 in arguments ? this.attr(attrName, value) : this.attr(attrName);
                return data !== null ? deserializeValue(data) : undefined;
            },
            val: function (value) {
                if (0 in arguments) {
                    if (value == null)
                        value = '';
                    return this.each(function (idx) {
                        this.value = funcArg(this, value, idx, this.value);
                    });
                } else {
                    return this[0] && (this[0].multiple ? $(this[0]).find('option').filter(function () {
                        return this.selected;
                    }).pluck('value') : this[0].value);
                }
            },
            offset: function (coordinates) {
                if (coordinates)
                    return this.each(function (index) {
                        var $this = $(this), coords = funcArg(this, coordinates, index, $this.offset()), parentOffset = $this.offsetParent().offset(), props = {
                                top: coords.top - parentOffset.top,
                                left: coords.left - parentOffset.left
                            };
                        if ($this.css('position') == 'static')
                            props['position'] = 'relative';
                        $this.css(props);
                    });
                if (!this.length)
                    return null;
                if (document.documentElement !== this[0] && !$.contains(document.documentElement, this[0]))
                    return {
                        top: 0,
                        left: 0
                    };
                var obj = this[0].getBoundingClientRect();
                return {
                    left: obj.left + window.pageXOffset,
                    top: obj.top + window.pageYOffset,
                    width: Math.round(obj.width),
                    height: Math.round(obj.height)
                };
            },
            css: function (property, value) {
                if (arguments.length < 2) {
                    var element = this[0];
                    if (typeof property == 'string') {
                        if (!element)
                            return;
                        return element.style[camelize(property)] || getComputedStyle(element, '').getPropertyValue(property);
                    } else if (isArray(property)) {
                        if (!element)
                            return;
                        var props = {};
                        var computedStyle = getComputedStyle(element, '');
                        $.each(property, function (_, prop) {
                            props[prop] = element.style[camelize(prop)] || computedStyle.getPropertyValue(prop);
                        });
                        return props;
                    }
                }
                var css = '';
                if (type(property) == 'string') {
                    if (!value && value !== 0)
                        this.each(function () {
                            this.style.removeProperty(dasherize(property));
                        });
                    else
                        css = dasherize(property) + ':' + maybeAddPx(property, value);
                } else {
                    for (key in property)
                        if (!property[key] && property[key] !== 0)
                            this.each(function () {
                                this.style.removeProperty(dasherize(key));
                            });
                        else
                            css += dasherize(key) + ':' + maybeAddPx(key, property[key]) + ';';
                }
                return this.each(function () {
                    this.style.cssText += ';' + css;
                });
            },
            index: function (element) {
                return element ? this.indexOf($(element)[0]) : this.parent().children().indexOf(this[0]);
            },
            hasClass: function (name) {
                if (!name)
                    return false;
                return emptyArray.some.call(this, function (el) {
                    return this.test(className(el));
                }, classRE(name));
            },
            addClass: function (name) {
                if (!name)
                    return this;
                return this.each(function (idx) {
                    if (!('className' in this))
                        return;
                    classList = [];
                    var cls = className(this), newName = funcArg(this, name, idx, cls);
                    newName.split(/\s+/g).forEach(function (klass) {
                        if (!$(this).hasClass(klass))
                            classList.push(klass);
                    }, this);
                    classList.length && className(this, cls + (cls ? ' ' : '') + classList.join(' '));
                });
            },
            removeClass: function (name) {
                return this.each(function (idx) {
                    if (!('className' in this))
                        return;
                    if (name === undefined)
                        return className(this, '');
                    classList = className(this);
                    funcArg(this, name, idx, classList).split(/\s+/g).forEach(function (klass) {
                        classList = classList.replace(classRE(klass), ' ');
                    });
                    className(this, classList.trim());
                });
            },
            toggleClass: function (name, when) {
                if (!name)
                    return this;
                return this.each(function (idx) {
                    var $this = $(this), names = funcArg(this, name, idx, className(this));
                    names.split(/\s+/g).forEach(function (klass) {
                        (when === undefined ? !$this.hasClass(klass) : when) ? $this.addClass(klass) : $this.removeClass(klass);
                    });
                });
            },
            scrollTop: function (value) {
                if (!this.length)
                    return;
                var hasScrollTop = 'scrollTop' in this[0];
                if (value === undefined)
                    return hasScrollTop ? this[0].scrollTop : this[0].pageYOffset;
                return this.each(hasScrollTop ? function () {
                    this.scrollTop = value;
                } : function () {
                    this.scrollTo(this.scrollX, value);
                });
            },
            scrollLeft: function (value) {
                if (!this.length)
                    return;
                var hasScrollLeft = 'scrollLeft' in this[0];
                if (value === undefined)
                    return hasScrollLeft ? this[0].scrollLeft : this[0].pageXOffset;
                return this.each(hasScrollLeft ? function () {
                    this.scrollLeft = value;
                } : function () {
                    this.scrollTo(value, this.scrollY);
                });
            },
            position: function () {
                if (!this.length)
                    return;
                var elem = this[0],
                    // Get *real* offsetParent
                    offsetParent = this.offsetParent(),
                    // Get correct offsets
                    offset = this.offset(), parentOffset = rootNodeRE.test(offsetParent[0].nodeName) ? {
                        top: 0,
                        left: 0
                    } : offsetParent.offset();
                // Subtract element margins
                // note: when an element has margin: auto the offsetLeft and marginLeft
                // are the same in Safari causing offset.left to incorrectly be 0
                offset.top -= parseFloat($(elem).css('margin-top')) || 0;
                offset.left -= parseFloat($(elem).css('margin-left')) || 0;
                // Add offsetParent borders
                parentOffset.top += parseFloat($(offsetParent[0]).css('border-top-width')) || 0;
                parentOffset.left += parseFloat($(offsetParent[0]).css('border-left-width')) || 0;
                // Subtract the two offsets
                return {
                    top: offset.top - parentOffset.top,
                    left: offset.left - parentOffset.left
                };
            },
            offsetParent: function () {
                return this.map(function () {
                    var parent = this.offsetParent || document.body;
                    while (parent && !rootNodeRE.test(parent.nodeName) && $(parent).css('position') == 'static')
                        parent = parent.offsetParent;
                    return parent;
                });
            }
        };
        // for now
        $.fn.detach = $.fn.remove;
        [
            'width',
            'height'
        ].forEach(function (dimension) {
            var dimensionProperty = dimension.replace(/./, function (m) {
                return m[0].toUpperCase();
            });
            $.fn[dimension] = function (value) {
                var offset, el = this[0];
                if (value === undefined)
                    return isWindow(el) ? el['inner' + dimensionProperty] : isDocument(el) ? el.documentElement['scroll' + dimensionProperty] : (offset = this.offset()) && offset[dimension];
                else
                    return this.each(function (idx) {
                        el = $(this);
                        el.css(dimension, funcArg(this, value, idx, el[dimension]()));
                    });
            };
        });
        function traverseNode(node, fun) {
            fun(node);
            for (var i = 0, len = node.childNodes.length; i < len; i++)
                traverseNode(node.childNodes[i], fun);
        }
        // Generate the `after`, `prepend`, `before`, `append`,
        // `insertAfter`, `insertBefore`, `appendTo`, and `prependTo` methods.
        adjacencyOperators.forEach(function (operator, operatorIndex) {
            var inside = operatorIndex % 2;
            //=> prepend, append
            $.fn[operator] = function () {
                // arguments can be nodes, arrays of nodes, Zepto objects and HTML strings
                var argType, nodes = $.map(arguments, function (arg) {
                        var arr = [];
                        argType = type(arg);
                        if (argType == 'array') {
                            arg.forEach(function (el) {
                                if (el.nodeType !== undefined)
                                    return arr.push(el);
                                else if ($.zepto.isZ(el))
                                    return arr = arr.concat(el.get());
                                arr = arr.concat(zepto.fragment(el));
                            });
                            return arr;
                        }
                        return argType == 'object' || arg == null ? arg : zepto.fragment(arg);
                    }), parent, copyByClone = this.length > 1;
                if (nodes.length < 1)
                    return this;
                return this.each(function (_, target) {
                    parent = inside ? target : target.parentNode;
                    // convert all methods to a "before" operation
                    target = operatorIndex == 0 ? target.nextSibling : operatorIndex == 1 ? target.firstChild : operatorIndex == 2 ? target : null;
                    var parentInDocument = $.contains(document.documentElement, parent);
                    nodes.forEach(function (node) {
                        if (copyByClone)
                            node = node.cloneNode(true);
                        else if (!parent)
                            return $(node).remove();
                        parent.insertBefore(node, target);
                        if (parentInDocument)
                            traverseNode(node, function (el) {
                                if (el.nodeName != null && el.nodeName.toUpperCase() === 'SCRIPT' && (!el.type || el.type === 'text/javascript') && !el.src) {
                                    var target = el.ownerDocument ? el.ownerDocument.defaultView : window;
                                    target['eval'].call(target, el.innerHTML);
                                }
                            });
                    });
                });
            };
            // after    => insertAfter
            // prepend  => prependTo
            // before   => insertBefore
            // append   => appendTo
            $.fn[inside ? operator + 'To' : 'insert' + (operatorIndex ? 'Before' : 'After')] = function (html) {
                $(html)[operator](this);
                return this;
            };
        });
        zepto.Z.prototype = Z.prototype = $.fn;
        // Export internal API functions in the `$.zepto` namespace
        zepto.uniq = uniq;
        zepto.deserializeValue = deserializeValue;
        $.zepto = zepto;
        return $;
    }();
    window.Zepto = Zepto;
    window.$ === undefined && (window.$ = Zepto);
    (function ($) {
        var _zid = 1, undefined, slice = Array.prototype.slice, isFunction = $.isFunction, isString = function (obj) {
                return typeof obj == 'string';
            }, handlers = {}, specialEvents = {}, focusinSupported = 'onfocusin' in window, focus = {
                focus: 'focusin',
                blur: 'focusout'
            }, hover = {
                mouseenter: 'mouseover',
                mouseleave: 'mouseout'
            };
        specialEvents.click = specialEvents.mousedown = specialEvents.mouseup = specialEvents.mousemove = 'MouseEvents';
        function zid(element) {
            return element._zid || (element._zid = _zid++);
        }
        function findHandlers(element, event, fn, selector) {
            event = parse(event);
            if (event.ns)
                var matcher = matcherFor(event.ns);
            return (handlers[zid(element)] || []).filter(function (handler) {
                return handler && (!event.e || handler.e == event.e) && (!event.ns || matcher.test(handler.ns)) && (!fn || zid(handler.fn) === zid(fn)) && (!selector || handler.sel == selector);
            });
        }
        function parse(event) {
            var parts = ('' + event).split('.');
            return {
                e: parts[0],
                ns: parts.slice(1).sort().join(' ')
            };
        }
        function matcherFor(ns) {
            return new RegExp('(?:^| )' + ns.replace(' ', ' .* ?') + '(?: |$)');
        }
        function eventCapture(handler, captureSetting) {
            return handler.del && (!focusinSupported && handler.e in focus) || !!captureSetting;
        }
        function realEvent(type) {
            return hover[type] || focusinSupported && focus[type] || type;
        }
        function add(element, events, fn, data, selector, delegator, capture) {
            var id = zid(element), set = handlers[id] || (handlers[id] = []);
            events.split(/\s/).forEach(function (event) {
                if (event == 'ready')
                    return $(document).ready(fn);
                var handler = parse(event);
                handler.fn = fn;
                handler.sel = selector;
                // emulate mouseenter, mouseleave
                if (handler.e in hover)
                    fn = function (e) {
                        var related = e.relatedTarget;
                        if (!related || related !== this && !$.contains(this, related))
                            return handler.fn.apply(this, arguments);
                    };
                handler.del = delegator;
                var callback = delegator || fn;
                handler.proxy = function (e) {
                    e = compatible(e);
                    if (e.isImmediatePropagationStopped())
                        return;
                    e.data = data;
                    var result = callback.apply(element, e._args == undefined ? [e] : [e].concat(e._args));
                    if (result === false)
                        e.preventDefault(), e.stopPropagation();
                    return result;
                };
                handler.i = set.length;
                set.push(handler);
                if ('addEventListener' in element)
                    element.addEventListener(realEvent(handler.e), handler.proxy, eventCapture(handler, capture));
            });
        }
        function remove(element, events, fn, selector, capture) {
            var id = zid(element);
            (events || '').split(/\s/).forEach(function (event) {
                findHandlers(element, event, fn, selector).forEach(function (handler) {
                    delete handlers[id][handler.i];
                    if ('removeEventListener' in element)
                        element.removeEventListener(realEvent(handler.e), handler.proxy, eventCapture(handler, capture));
                });
            });
        }
        $.event = {
            add: add,
            remove: remove
        };
        $.proxy = function (fn, context) {
            var args = 2 in arguments && slice.call(arguments, 2);
            if (isFunction(fn)) {
                var proxyFn = function () {
                    return fn.apply(context, args ? args.concat(slice.call(arguments)) : arguments);
                };
                proxyFn._zid = zid(fn);
                return proxyFn;
            } else if (isString(context)) {
                if (args) {
                    args.unshift(fn[context], fn);
                    return $.proxy.apply(null, args);
                } else {
                    return $.proxy(fn[context], fn);
                }
            } else {
                throw new TypeError('expected function');
            }
        };
        $.fn.bind = function (event, data, callback) {
            return this.on(event, data, callback);
        };
        $.fn.unbind = function (event, callback) {
            return this.off(event, callback);
        };
        $.fn.one = function (event, selector, data, callback) {
            return this.on(event, selector, data, callback, 1);
        };
        var returnTrue = function () {
                return true;
            }, returnFalse = function () {
                return false;
            }, ignoreProperties = /^([A-Z]|returnValue$|layer[XY]$|webkitMovement[XY]$)/, eventMethods = {
                preventDefault: 'isDefaultPrevented',
                stopImmediatePropagation: 'isImmediatePropagationStopped',
                stopPropagation: 'isPropagationStopped'
            };
        function compatible(event, source) {
            if (source || !event.isDefaultPrevented) {
                source || (source = event);
                $.each(eventMethods, function (name, predicate) {
                    var sourceMethod = source[name];
                    event[name] = function () {
                        this[predicate] = returnTrue;
                        return sourceMethod && sourceMethod.apply(source, arguments);
                    };
                    event[predicate] = returnFalse;
                });
                event.timeStamp || (event.timeStamp = Date.now());
                if (source.defaultPrevented !== undefined ? source.defaultPrevented : 'returnValue' in source ? source.returnValue === false : source.getPreventDefault && source.getPreventDefault())
                    event.isDefaultPrevented = returnTrue;
            }
            return event;
        }
        function createProxy(event) {
            var key, proxy = { originalEvent: event };
            for (key in event)
                if (!ignoreProperties.test(key) && event[key] !== undefined)
                    proxy[key] = event[key];
            return compatible(proxy, event);
        }
        $.fn.delegate = function (selector, event, callback) {
            return this.on(event, selector, callback);
        };
        $.fn.undelegate = function (selector, event, callback) {
            return this.off(event, selector, callback);
        };
        $.fn.live = function (event, callback) {
            $(document.body).delegate(this.selector, event, callback);
            return this;
        };
        $.fn.die = function (event, callback) {
            $(document.body).undelegate(this.selector, event, callback);
            return this;
        };
        $.fn.on = function (event, selector, data, callback, one) {
            var autoRemove, delegator, $this = this;
            if (event && !isString(event)) {
                $.each(event, function (type, fn) {
                    $this.on(type, selector, data, fn, one);
                });
                return $this;
            }
            if (!isString(selector) && !isFunction(callback) && callback !== false)
                callback = data, data = selector, selector = undefined;
            if (callback === undefined || data === false)
                callback = data, data = undefined;
            if (callback === false)
                callback = returnFalse;
            return $this.each(function (_, element) {
                if (one)
                    autoRemove = function (e) {
                        remove(element, e.type, callback);
                        return callback.apply(this, arguments);
                    };
                if (selector)
                    delegator = function (e) {
                        var evt, match = $(e.target).closest(selector, element).get(0);
                        if (match && match !== element) {
                            evt = $.extend(createProxy(e), {
                                currentTarget: match,
                                liveFired: element
                            });
                            return (autoRemove || callback).apply(match, [evt].concat(slice.call(arguments, 1)));
                        }
                    };
                add(element, event, callback, data, selector, delegator || autoRemove);
            });
        };
        $.fn.off = function (event, selector, callback) {
            var $this = this;
            if (event && !isString(event)) {
                $.each(event, function (type, fn) {
                    $this.off(type, selector, fn);
                });
                return $this;
            }
            if (!isString(selector) && !isFunction(callback) && callback !== false)
                callback = selector, selector = undefined;
            if (callback === false)
                callback = returnFalse;
            return $this.each(function () {
                remove(this, event, callback, selector);
            });
        };
        $.fn.trigger = function (event, args) {
            event = isString(event) || $.isPlainObject(event) ? $.Event(event) : compatible(event);
            event._args = args;
            return this.each(function () {
                // handle focus(), blur() by calling them directly
                if (event.type in focus && typeof this[event.type] == 'function')
                    this[event.type]()    // items in the collection might not be DOM elements
;
                else if ('dispatchEvent' in this)
                    this.dispatchEvent(event);
                else
                    $(this).triggerHandler(event, args);
            });
        };
        // triggers event handlers on current element just as if an event occurred,
        // doesn't trigger an actual event, doesn't bubble
        $.fn.triggerHandler = function (event, args) {
            var e, result;
            this.each(function (i, element) {
                e = createProxy(isString(event) ? $.Event(event) : event);
                e._args = args;
                e.target = element;
                $.each(findHandlers(element, event.type || event), function (i, handler) {
                    result = handler.proxy(e);
                    if (e.isImmediatePropagationStopped())
                        return false;
                });
            });
            return result;
        }    // shortcut methods for `.bind(event, fn)` for each event type
;
        ('focusin focusout focus blur load resize scroll unload click dblclick ' + 'mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave ' + 'change select keydown keypress keyup error').split(' ').forEach(function (event) {
            $.fn[event] = function (callback) {
                return 0 in arguments ? this.bind(event, callback) : this.trigger(event);
            };
        });
        $.Event = function (type, props) {
            if (!isString(type))
                props = type, type = props.type;
            var event = document.createEvent(specialEvents[type] || 'Events'), bubbles = true;
            if (props)
                for (var name in props)
                    name == 'bubbles' ? bubbles = !!props[name] : event[name] = props[name];
            event.initEvent(type, bubbles, true);
            return compatible(event);
        };
    }(Zepto));
    (function ($) {
        var jsonpID = +new Date(), document = window.document, key, name, rscript = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, scriptTypeRE = /^(?:text|application)\/javascript/i, xmlTypeRE = /^(?:text|application)\/xml/i, jsonType = 'application/json', htmlType = 'text/html', blankRE = /^\s*$/, originAnchor = document.createElement('a');
        originAnchor.href = window.location.href;
        // trigger a custom event and return false if it was cancelled
        function triggerAndReturn(context, eventName, data) {
            var event = $.Event(eventName);
            $(context).trigger(event, data);
            return !event.isDefaultPrevented();
        }
        // trigger an Ajax "global" event
        function triggerGlobal(settings, context, eventName, data) {
            if (settings.global)
                return triggerAndReturn(context || document, eventName, data);
        }
        // Number of active Ajax requests
        $.active = 0;
        function ajaxStart(settings) {
            if (settings.global && $.active++ === 0)
                triggerGlobal(settings, null, 'ajaxStart');
        }
        function ajaxStop(settings) {
            if (settings.global && !--$.active)
                triggerGlobal(settings, null, 'ajaxStop');
        }
        // triggers an extra global event "ajaxBeforeSend" that's like "ajaxSend" but cancelable
        function ajaxBeforeSend(xhr, settings) {
            var context = settings.context;
            if (settings.beforeSend.call(context, xhr, settings) === false || triggerGlobal(settings, context, 'ajaxBeforeSend', [
                    xhr,
                    settings
                ]) === false)
                return false;
            triggerGlobal(settings, context, 'ajaxSend', [
                xhr,
                settings
            ]);
        }
        function ajaxSuccess(data, xhr, settings, deferred) {
            var context = settings.context, status = 'success';
            settings.success.call(context, data, status, xhr);
            if (deferred)
                deferred.resolveWith(context, [
                    data,
                    status,
                    xhr
                ]);
            triggerGlobal(settings, context, 'ajaxSuccess', [
                xhr,
                settings,
                data
            ]);
            ajaxComplete(status, xhr, settings);
        }
        // type: "timeout", "error", "abort", "parsererror"
        function ajaxError(error, type, xhr, settings, deferred) {
            var context = settings.context;
            settings.error.call(context, xhr, type, error);
            if (deferred)
                deferred.rejectWith(context, [
                    xhr,
                    type,
                    error
                ]);
            triggerGlobal(settings, context, 'ajaxError', [
                xhr,
                settings,
                error || type
            ]);
            ajaxComplete(type, xhr, settings);
        }
        // status: "success", "notmodified", "error", "timeout", "abort", "parsererror"
        function ajaxComplete(status, xhr, settings) {
            var context = settings.context;
            settings.complete.call(context, xhr, status);
            triggerGlobal(settings, context, 'ajaxComplete', [
                xhr,
                settings
            ]);
            ajaxStop(settings);
        }
        function ajaxDataFilter(data, type, settings) {
            if (settings.dataFilter == empty)
                return data;
            var context = settings.context;
            return settings.dataFilter.call(context, data, type);
        }
        // Empty function, used as default callback
        function empty() {
        }
        $.ajaxJSONP = function (options, deferred) {
            if (!('type' in options))
                return $.ajax(options);
            var _callbackName = options.jsonpCallback, callbackName = ($.isFunction(_callbackName) ? _callbackName() : _callbackName) || 'Zepto' + jsonpID++, script = document.createElement('script'), originalCallback = window[callbackName], responseData, abort = function (errorType) {
                    $(script).triggerHandler('error', errorType || 'abort');
                }, xhr = { abort: abort }, abortTimeout;
            if (deferred)
                deferred.promise(xhr);
            $(script).on('load error', function (e, errorType) {
                clearTimeout(abortTimeout);
                $(script).off().remove();
                if (e.type == 'error' || !responseData) {
                    ajaxError(null, errorType || 'error', xhr, options, deferred);
                } else {
                    ajaxSuccess(responseData[0], xhr, options, deferred);
                }
                window[callbackName] = originalCallback;
                if (responseData && $.isFunction(originalCallback))
                    originalCallback(responseData[0]);
                originalCallback = responseData = undefined;
            });
            if (ajaxBeforeSend(xhr, options) === false) {
                abort('abort');
                return xhr;
            }
            window[callbackName] = function () {
                responseData = arguments;
            };
            script.src = options.url.replace(/\?(.+)=\?/, '?$1=' + callbackName);
            document.head.appendChild(script);
            if (options.timeout > 0)
                abortTimeout = setTimeout(function () {
                    abort('timeout');
                }, options.timeout);
            return xhr;
        };
        $.ajaxSettings = {
            // Default type of request
            type: 'GET',
            // Callback that is executed before request
            beforeSend: empty,
            // Callback that is executed if the request succeeds
            success: empty,
            // Callback that is executed the the server drops error
            error: empty,
            // Callback that is executed on request complete (both: error and success)
            complete: empty,
            // The context for the callbacks
            context: null,
            // Whether to trigger "global" Ajax events
            global: true,
            // Transport
            xhr: function () {
                return new window.XMLHttpRequest();
            },
            // MIME types mapping
            // IIS returns Javascript as "application/x-javascript"
            accepts: {
                script: 'text/javascript, application/javascript, application/x-javascript',
                json: jsonType,
                xml: 'application/xml, text/xml',
                html: htmlType,
                text: 'text/plain'
            },
            // Whether the request is to another domain
            crossDomain: false,
            // Default timeout
            timeout: 0,
            // Whether data should be serialized to string
            processData: true,
            // Whether the browser should be allowed to cache GET responses
            cache: true,
            //Used to handle the raw response data of XMLHttpRequest.
            //This is a pre-filtering function to sanitize the response.
            //The sanitized response should be returned
            dataFilter: empty
        };
        function mimeToDataType(mime) {
            if (mime)
                mime = mime.split(';', 2)[0];
            return mime && (mime == htmlType ? 'html' : mime == jsonType ? 'json' : scriptTypeRE.test(mime) ? 'script' : xmlTypeRE.test(mime) && 'xml') || 'text';
        }
        function appendQuery(url, query) {
            if (query == '')
                return url;
            return (url + '&' + query).replace(/[&?]{1,2}/, '?');
        }
        // serialize payload and append it to the URL for GET requests
        function serializeData(options) {
            if (options.processData && options.data && $.type(options.data) != 'string')
                options.data = $.param(options.data, options.traditional);
            if (options.data && (!options.type || options.type.toUpperCase() == 'GET' || 'jsonp' == options.dataType))
                options.url = appendQuery(options.url, options.data), options.data = undefined;
        }
        $.ajax = function (options) {
            var settings = $.extend({}, options || {}), deferred = $.Deferred && $.Deferred(), urlAnchor, hashIndex;
            for (key in $.ajaxSettings)
                if (settings[key] === undefined)
                    settings[key] = $.ajaxSettings[key];
            ajaxStart(settings);
            if (!settings.crossDomain) {
                urlAnchor = document.createElement('a');
                urlAnchor.href = settings.url;
                // cleans up URL for .href (IE only), see https://github.com/madrobby/zepto/pull/1049
                urlAnchor.href = urlAnchor.href;
                settings.crossDomain = originAnchor.protocol + '//' + originAnchor.host !== urlAnchor.protocol + '//' + urlAnchor.host;
            }
            if (!settings.url)
                settings.url = window.location.toString();
            if ((hashIndex = settings.url.indexOf('#')) > -1)
                settings.url = settings.url.slice(0, hashIndex);
            serializeData(settings);
            var dataType = settings.dataType, hasPlaceholder = /\?.+=\?/.test(settings.url);
            if (hasPlaceholder)
                dataType = 'jsonp';
            if (settings.cache === false || (!options || options.cache !== true) && ('script' == dataType || 'jsonp' == dataType))
                settings.url = appendQuery(settings.url, '_=' + Date.now());
            if ('jsonp' == dataType) {
                if (!hasPlaceholder)
                    settings.url = appendQuery(settings.url, settings.jsonp ? settings.jsonp + '=?' : settings.jsonp === false ? '' : 'callback=?');
                return $.ajaxJSONP(settings, deferred);
            }
            var mime = settings.accepts[dataType], headers = {}, setHeader = function (name, value) {
                    headers[name.toLowerCase()] = [
                        name,
                        value
                    ];
                }, protocol = /^([\w-]+:)\/\//.test(settings.url) ? RegExp.$1 : window.location.protocol, xhr = settings.xhr(), nativeSetHeader = xhr.setRequestHeader, abortTimeout;
            if (deferred)
                deferred.promise(xhr);
            if (!settings.crossDomain)
                setHeader('X-Requested-With', 'XMLHttpRequest');
            setHeader('Accept', mime || '*/*');
            if (mime = settings.mimeType || mime) {
                if (mime.indexOf(',') > -1)
                    mime = mime.split(',', 2)[0];
                xhr.overrideMimeType && xhr.overrideMimeType(mime);
            }
            if (settings.contentType || settings.contentType !== false && settings.data && settings.type.toUpperCase() != 'GET')
                setHeader('Content-Type', settings.contentType || 'application/x-www-form-urlencoded');
            if (settings.headers)
                for (name in settings.headers)
                    setHeader(name, settings.headers[name]);
            xhr.setRequestHeader = setHeader;
            xhr.onreadystatechange = function () {
                if (xhr.readyState == 4) {
                    xhr.onreadystatechange = empty;
                    clearTimeout(abortTimeout);
                    var result, error = false;
                    if (xhr.status >= 200 && xhr.status < 300 || xhr.status == 304 || xhr.status == 0 && protocol == 'file:') {
                        dataType = dataType || mimeToDataType(settings.mimeType || xhr.getResponseHeader('content-type'));
                        if (xhr.responseType == 'arraybuffer' || xhr.responseType == 'blob')
                            result = xhr.response;
                        else {
                            result = xhr.responseText;
                            try {
                                // http://perfectionkills.com/global-eval-what-are-the-options/
                                // sanitize response accordingly if data filter callback provided
                                result = ajaxDataFilter(result, dataType, settings);
                                if (dataType == 'script')
                                    (1, eval)(result);
                                else if (dataType == 'xml')
                                    result = xhr.responseXML;
                                else if (dataType == 'json')
                                    result = blankRE.test(result) ? null : $.parseJSON(result);
                            } catch (e) {
                                error = e;
                            }
                            if (error)
                                return ajaxError(error, 'parsererror', xhr, settings, deferred);
                        }
                        ajaxSuccess(result, xhr, settings, deferred);
                    } else {
                        ajaxError(xhr.statusText || null, xhr.status ? 'error' : 'abort', xhr, settings, deferred);
                    }
                }
            };
            if (ajaxBeforeSend(xhr, settings) === false) {
                xhr.abort();
                ajaxError(null, 'abort', xhr, settings, deferred);
                return xhr;
            }
            var async = 'async' in settings ? settings.async : true;
            xhr.open(settings.type, settings.url, async, settings.username, settings.password);
            if (settings.xhrFields)
                for (name in settings.xhrFields)
                    xhr[name] = settings.xhrFields[name];
            for (name in headers)
                nativeSetHeader.apply(xhr, headers[name]);
            if (settings.timeout > 0)
                abortTimeout = setTimeout(function () {
                    xhr.onreadystatechange = empty;
                    xhr.abort();
                    ajaxError(null, 'timeout', xhr, settings, deferred);
                }, settings.timeout);
            // avoid sending empty string (#319)
            xhr.send(settings.data ? settings.data : null);
            return xhr;
        };
        // handle optional data/success arguments
        function parseArguments(url, data, success, dataType) {
            if ($.isFunction(data))
                dataType = success, success = data, data = undefined;
            if (!$.isFunction(success))
                dataType = success, success = undefined;
            return {
                url: url,
                data: data,
                success: success,
                dataType: dataType
            };
        }
        $.get = function () {
            return $.ajax(parseArguments.apply(null, arguments));
        };
        $.post = function () {
            var options = parseArguments.apply(null, arguments);
            options.type = 'POST';
            return $.ajax(options);
        };
        $.getJSON = function () {
            var options = parseArguments.apply(null, arguments);
            options.dataType = 'json';
            return $.ajax(options);
        };
        $.fn.load = function (url, data, success) {
            if (!this.length)
                return this;
            var self = this, parts = url.split(/\s/), selector, options = parseArguments(url, data, success), callback = options.success;
            if (parts.length > 1)
                options.url = parts[0], selector = parts[1];
            options.success = function (response) {
                self.html(selector ? $('<div>').html(response.replace(rscript, '')).find(selector) : response);
                callback && callback.apply(self, arguments);
            };
            $.ajax(options);
            return this;
        };
        var escape = encodeURIComponent;
        function serialize(params, obj, traditional, scope) {
            var type, array = $.isArray(obj), hash = $.isPlainObject(obj);
            $.each(obj, function (key, value) {
                type = $.type(value);
                if (scope)
                    key = traditional ? scope : scope + '[' + (hash || type == 'object' || type == 'array' ? key : '') + ']';
                // handle data in serializeArray() format
                if (!scope && array)
                    params.add(value.name, value.value)    // recurse into nested objects
;
                else if (type == 'array' || !traditional && type == 'object')
                    serialize(params, value, traditional, key);
                else
                    params.add(key, value);
            });
        }
        $.param = function (obj, traditional) {
            var params = [];
            params.add = function (key, value) {
                if ($.isFunction(value))
                    value = value();
                if (value == null)
                    value = '';
                this.push(escape(key) + '=' + escape(value));
            };
            serialize(params, obj, traditional);
            return params.join('&').replace(/%20/g, '+');
        };
    }(Zepto));
    (function () {
        // getComputedStyle shouldn't freak out when called
        // without a valid element as argument
        try {
            getComputedStyle(undefined);
        } catch (e) {
            var nativeGetComputedStyle = getComputedStyle;
            window.getComputedStyle = function (element, pseudoElement) {
                try {
                    return nativeGetComputedStyle(element, pseudoElement);
                } catch (e) {
                    return null;
                }
            };
        }
    }());
    (function ($) {
        $.fn.serializeArray = function () {
            var name, type, result = [], add = function (value) {
                    if (value.forEach)
                        return value.forEach(add);
                    result.push({
                        name: name,
                        value: value
                    });
                };
            if (this[0])
                $.each(this[0].elements, function (_, field) {
                    type = field.type, name = field.name;
                    if (name && field.nodeName.toLowerCase() != 'fieldset' && !field.disabled && type != 'submit' && type != 'reset' && type != 'button' && type != 'file' && (type != 'radio' && type != 'checkbox' || field.checked))
                        add($(field).val());
                });
            return result;
        };
        $.fn.serialize = function () {
            var result = [];
            this.serializeArray().forEach(function (elm) {
                result.push(encodeURIComponent(elm.name) + '=' + encodeURIComponent(elm.value));
            });
            return result.join('&');
        };
        $.fn.submit = function (callback) {
            if (0 in arguments)
                this.bind('submit', callback);
            else if (this.length) {
                var event = $.Event('submit');
                this.eq(0).trigger(event);
                if (!event.isDefaultPrevented())
                    this.get(0).submit();
            }
            return this;
        };
    }(Zepto));
    (function ($, undefined) {
        var prefix = '', eventPrefix, vendors = {
                Webkit: 'webkit',
                Moz: '',
                O: 'o'
            }, testEl = document.createElement('div'), supportedTransforms = /^((translate|rotate|scale)(X|Y|Z|3d)?|matrix(3d)?|perspective|skew(X|Y)?)$/i, transform, transitionProperty, transitionDuration, transitionTiming, transitionDelay, animationName, animationDuration, animationTiming, animationDelay, cssReset = {};
        function dasherize(str) {
            return str.replace(/([A-Z])/g, '-$1').toLowerCase();
        }
        function normalizeEvent(name) {
            return eventPrefix ? eventPrefix + name : name.toLowerCase();
        }
        if (testEl.style.transform === undefined)
            $.each(vendors, function (vendor, event) {
                if (testEl.style[vendor + 'TransitionProperty'] !== undefined) {
                    prefix = '-' + vendor.toLowerCase() + '-';
                    eventPrefix = event;
                    return false;
                }
            });
        transform = prefix + 'transform';
        cssReset[transitionProperty = prefix + 'transition-property'] = cssReset[transitionDuration = prefix + 'transition-duration'] = cssReset[transitionDelay = prefix + 'transition-delay'] = cssReset[transitionTiming = prefix + 'transition-timing-function'] = cssReset[animationName = prefix + 'animation-name'] = cssReset[animationDuration = prefix + 'animation-duration'] = cssReset[animationDelay = prefix + 'animation-delay'] = cssReset[animationTiming = prefix + 'animation-timing-function'] = '';
        $.fx = {
            off: eventPrefix === undefined && testEl.style.transitionProperty === undefined,
            speeds: {
                _default: 400,
                fast: 200,
                slow: 600
            },
            cssPrefix: prefix,
            transitionEnd: normalizeEvent('TransitionEnd'),
            animationEnd: normalizeEvent('AnimationEnd')
        };
        $.fn.animate = function (properties, duration, ease, callback, delay) {
            if ($.isFunction(duration))
                callback = duration, ease = undefined, duration = undefined;
            if ($.isFunction(ease))
                callback = ease, ease = undefined;
            if ($.isPlainObject(duration))
                ease = duration.easing, callback = duration.complete, delay = duration.delay, duration = duration.duration;
            if (duration)
                duration = (typeof duration == 'number' ? duration : $.fx.speeds[duration] || $.fx.speeds._default) / 1000;
            if (delay)
                delay = parseFloat(delay) / 1000;
            return this.anim(properties, duration, ease, callback, delay);
        };
        $.fn.anim = function (properties, duration, ease, callback, delay) {
            var key, cssValues = {}, cssProperties, transforms = '', that = this, wrappedCallback, endEvent = $.fx.transitionEnd, fired = false;
            if (duration === undefined)
                duration = $.fx.speeds._default / 1000;
            if (delay === undefined)
                delay = 0;
            if ($.fx.off)
                duration = 0;
            if (typeof properties == 'string') {
                // keyframe animation
                cssValues[animationName] = properties;
                cssValues[animationDuration] = duration + 's';
                cssValues[animationDelay] = delay + 's';
                cssValues[animationTiming] = ease || 'linear';
                endEvent = $.fx.animationEnd;
            } else {
                cssProperties = [];
                // CSS transitions
                for (key in properties)
                    if (supportedTransforms.test(key))
                        transforms += key + '(' + properties[key] + ') ';
                    else
                        cssValues[key] = properties[key], cssProperties.push(dasherize(key));
                if (transforms)
                    cssValues[transform] = transforms, cssProperties.push(transform);
                if (duration > 0 && typeof properties === 'object') {
                    cssValues[transitionProperty] = cssProperties.join(', ');
                    cssValues[transitionDuration] = duration + 's';
                    cssValues[transitionDelay] = delay + 's';
                    cssValues[transitionTiming] = ease || 'linear';
                }
            }
            wrappedCallback = function (event) {
                if (typeof event !== 'undefined') {
                    if (event.target !== event.currentTarget)
                        return;
                    // makes sure the event didn't bubble from "below"
                    $(event.target).unbind(endEvent, wrappedCallback);
                } else
                    $(this).unbind(endEvent, wrappedCallback);
                // triggered by setTimeout
                fired = true;
                $(this).css(cssReset);
                callback && callback.call(this);
            };
            if (duration > 0) {
                this.bind(endEvent, wrappedCallback);
                // transitionEnd is not always firing on older Android phones
                // so make sure it gets fired
                setTimeout(function () {
                    if (fired)
                        return;
                    wrappedCallback.call(that);
                }, (duration + delay) * 1000 + 25);
            }
            // trigger page reflow so new elements can animate
            this.size() && this.get(0).clientLeft;
            this.css(cssValues);
            if (duration <= 0)
                setTimeout(function () {
                    that.each(function () {
                        wrappedCallback.call(this);
                    });
                }, 0);
            return this;
        };
        testEl = null;
    }(Zepto));
    (function ($, undefined) {
        var document = window.document, docElem = document.documentElement, origShow = $.fn.show, origHide = $.fn.hide, origToggle = $.fn.toggle;
        function anim(el, speed, opacity, scale, callback) {
            if (typeof speed == 'function' && !callback)
                callback = speed, speed = undefined;
            var props = { opacity: opacity };
            if (scale) {
                props.scale = scale;
                el.css($.fx.cssPrefix + 'transform-origin', '0 0');
            }
            return el.animate(props, speed, null, callback);
        }
        function hide(el, speed, scale, callback) {
            return anim(el, speed, 0, scale, function () {
                origHide.call($(this));
                callback && callback.call(this);
            });
        }
        $.fn.show = function (speed, callback) {
            origShow.call(this);
            if (speed === undefined)
                speed = 0;
            else
                this.css('opacity', 0);
            return anim(this, speed, 1, '1,1', callback);
        };
        $.fn.hide = function (speed, callback) {
            if (speed === undefined)
                return origHide.call(this);
            else
                return hide(this, speed, '0,0', callback);
        };
        $.fn.toggle = function (speed, callback) {
            if (speed === undefined || typeof speed == 'boolean')
                return origToggle.call(this, speed);
            else
                return this.each(function () {
                    var el = $(this);
                    el[el.css('display') == 'none' ? 'show' : 'hide'](speed, callback);
                });
        };
        $.fn.fadeTo = function (speed, opacity, callback) {
            return anim(this, speed, opacity, null, callback);
        };
        $.fn.fadeIn = function (speed, callback) {
            var target = this.css('opacity');
            if (target > 0)
                this.css('opacity', 0);
            else
                target = 1;
            return origShow.call(this).fadeTo(speed, target, callback);
        };
        $.fn.fadeOut = function (speed, callback) {
            return hide(this, speed, null, callback);
        };
        $.fn.fadeToggle = function (speed, callback) {
            return this.each(function () {
                var el = $(this);
                el[el.css('opacity') == 0 || el.css('display') == 'none' ? 'fadeIn' : 'fadeOut'](speed, callback);
            });
        };
    }(Zepto));
    return Zepto;
}));

// ======================
// deps/naboo.js
// ======================


/**
 * @file naboo框架，包含核心调度模块和css3 transition动画工具函数
 * @author zhulei05(zhulei05@baidu.com)
 */
define('naboo', [], function () {
    /**
 * Naboo类，抽象出来的一个动画控制和执行的对象
 *
 * @constructor
 */
    function Naboo() {
        this.steps = [];
        this._index = -1;
        this._handlers = {};
        this.canceled = false;
    }
    /**
 * 开始执行动画的指令函数
 *
 * @param {Function=} fn - 动画完成后的回调函数
 * @return {Object} 当前naboo实例
 */
    Naboo.prototype.start = function (fn) {
        if (fn) {
            this.on('end', fn);
        }
        this.trigger('start');
        this.next(this);
        return this;
    };
    /**
 * 让动画进入下一步的指令函数，一般在Naboo插件中调用
 */
    Naboo.prototype.next = function () {
        if (this.canceled) {
            return;
        }
        this._index++;
        if (this._index >= this.steps.length) {
            this.trigger('end');
        } else {
            var currentStep = this.steps[this._index];
            currentStep.call(this);
        }
    };
    /**
 * 取消动画的指令，调用该函数后，当前未执行完的动画仍会继续执行完成，后续的动画不会执行
 */
    Naboo.prototype.cancel = function () {
        this.canceled = true;
    };
    /**
 * 事件绑定
 *
 * @param {string} name - 事件名
 * @param {Function} fn - 响应函数
 */
    Naboo.prototype.on = function (name, fn) {
        this._handlers[name] || (this._handlers[name] = []);
        this._handlers[name].push(fn);
    };
    /**
 * 解除事件绑定
 *
 * @param {string=} name - 事件名
 * @param {Function=} fn - 响应函数
 */
    Naboo.prototype.off = function (name, fn) {
        if (!name) {
            this._handlers = {};
        } else {
            var handlers = this._handlers[name];
            if (!fn) {
                this._handlers[name] = [];
            } else if (Object.prototype.toString.call(handlers) === '[object Array]') {
                for (var i = 0, len = handlers.length; i < len; i++) {
                    if (handlers[i] === fn) {
                        break;
                    }
                }
                this._handlers[name].splice(i, 1);
            }
        }
    };
    /**
 * 触发事件
 *
 * @param {string} name - 事件名
 * @param {*=} data - 触发事件时需要传递的数据
 */
    Naboo.prototype.trigger = function (name, data) {
        var handlers = this._handlers[name];
        if (handlers) {
            handlers.forEach(function (fn, i) {
                fn.call(null, data);
            });
        }
    };
    /**
 * 插件注册函数
 *
 * @param {string} name - 插件名
 * @param {Function} fn - 插件函数，用于定义插件的执行逻辑
 */
    Naboo.register = function (name, fn) {
        Naboo[name] = function () {
            var ret = new Naboo();
            ret[name].apply(ret, arguments);
            return ret;
        };
        Naboo.prototype[name] = function () {
            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift(this.next.bind(this));
            this.steps.push(function () {
                fn.apply(this, args);
            });
            return this;
        };
    };
    /**
 * Naboo#p & Naboo.p
 * Naboo的并行插件
 */
    Naboo.register('p', function (next) {
        var args = Array.prototype.slice.call(arguments, 1);
        var n = args.length;
        args.forEach(function (naboo) {
            naboo.start(function () {
                n--;
                if (n === 0) {
                    next();
                }
            });
        });
    });
    /**
 * Naboo#done & Naboo.done
 * Naboo的done插件，可用于在任何一个动画插件后进行回调
 */
    Naboo.register('done', function (next, fn) {
        fn(next);
    });
    Naboo.tool = function () {
        // 定义一批检测浏览器特性需要的变量
        var prefix = '';
        var eventPrefix = '';
        var vendors = {
            Webkit: 'webkit',
            Moz: '',
            O: 'o'
        };
        var testEl = document.createElement('div');
        function dasherize(str) {
            return str.replace(/([A-Z])/g, '-$1').toLowerCase();
        }
        function normalizeEvent(name) {
            return eventPrefix ? eventPrefix + name : name.toLowerCase();
        }
        // 检测浏览器特性
        if (testEl.style.transform === undefined) {
            for (var prop in vendors) {
                if (testEl.style[prop + 'TransitionProperty'] !== undefined) {
                    prefix = '-' + prop.toLowerCase() + '-';
                    eventPrefix = vendors[prop];
                    break;
                }
            }
        }
        // 是否不支持transition
        var off = eventPrefix === undefined && testEl.style.transitionProperty === undefined;
        /**
         * 设置dom对象的css
         *
         * 实现方法同zepto的css
         *
         * @param {Object} dom 要设置css的dom节点
         * @param {Object} obj 存放css信息的对象
         */
        function setCss(dom, obj) {
            var css = '';
            for (var key in obj) {
                if (!obj[key] && obj[key] !== 0) {
                    dom.style.removeProperty(dasherize(key));
                } else {
                    css += dasherize(key) + ':' + obj[key] + ';';
                }
            }
            dom.style.cssText += ';' + css;
        }
        /**
         * 给一个属性自动添加单位
         *
         * @param  {string} prop 属性名
         * @param  {string|number} val 属性值
         *
         * @return {string}     带单位的属性值
         */
        function handleUnit(prop, val) {
            if (val !== +val) {
                return val;
            }
            testEl.style[prop] = 0;
            var propValue = testEl.style[prop];
            var match = propValue.match && propValue.match(/^\d+([a-zA-Z]+)/);
            if (match) {
                return val + match[1];
            }
            return val;
        }
        /**
         * 获取正确的css属性名
         *
         * @param {string} 属性名
         * @return {string | undefined} 自动添加前缀后的属性名或者undefined
         */
        function getPropName(prop) {
            var res;
            if (testEl.style[prop] !== undefined) {
                res = prop;
            } else {
                for (var key in vendors) {
                    var val = '-' + vendors[key] + '-';
                    if (testEl.style[val + prop] !== undefined) {
                        res = val + prop;
                        break;
                    }
                }
            }
            return res;
        }
        return {
            prefix: prefix,
            dasherize: dasherize,
            normalizeEvent: normalizeEvent,
            off: off,
            setCss: setCss,
            handleUnit: handleUnit,
            getPropName: getPropName
        };
    }();
    /**
 * Naboo提供的执行css3 transiton动画的函数
 * @param {Object} dom - 需要进行动画的dom元素
 * @param {Object} property - 需要进行动画的css属性键值对对象
 * @param {number=} duration - 动画时长，单位ms
 * @param {string=} ease - 动画的缓动函数名，可选值包括`ease`、`linear`、`ease-in`、`ease-out`、`ease-in-out`
 * @param {number=} delay - 动画延迟执行的时间，单位ms
 * @param {Function=} cb - 动画完成后的回调函数
 */
    Naboo.transition = function () {
        var prefix = Naboo.tool.prefix;
        // css transition各属性名
        var transitionProperty = prefix + 'transition-property';
        var transitionDuration = prefix + 'transition-duration';
        var transitionDelay = prefix + 'transition-delay';
        var transitionTiming = prefix + 'transition-timing-function';
        var transitionEnd = Naboo.tool.normalizeEvent('TransitionEnd');
        // 动画完成后清空设置
        var cssReset = {};
        cssReset[transitionProperty] = '';
        cssReset[transitionDuration] = '';
        cssReset[transitionDelay] = '';
        cssReset[transitionTiming] = '';
        return function (dom, property, opt) {
            if (dom && Object.prototype.toString.call(property) === '[object Object]') {
                opt = opt || {};
                var duration = parseInt(opt.duration) || 400;
                var easeArr = [
                    'ease',
                    'linear',
                    'ease-in',
                    'ease-out',
                    'ease-in-out'
                ];
                var ease = easeArr.indexOf(opt.ease) > -1 ? opt.ease : 'ease';
                var delay = parseInt(opt.delay) || 0;
                var cb = typeof opt.cb === 'function' ? opt.cb : function () {
                };
                var nabooNum = dom.getAttribute('data-naboo');
                if (nabooNum !== +nabooNum) {
                    nabooNum = 0;
                }
                dom.setAttribute('data-naboo', nabooNum + 1);
                if (Naboo.tool.off) {
                    duration = 0;
                }
                duration = Math.max(duration, 0);
                duration /= 1000;
                delay /= 1000;
                var cssProperty = [];
                var cssValues = {};
                for (var key in property) {
                    if (!property.hasOwnProperty(key)) {
                        continue;
                    }
                    var originKey = key;
                    key = Naboo.tool.getPropName(key);
                    var value = Naboo.tool.handleUnit(key, property[originKey]);
                    cssValues[key] = value;
                    cssProperty.push(Naboo.tool.dasherize(key));
                }
                if (duration > 0) {
                    var transitionPropertyVal = dom.style[transitionProperty];
                    transitionPropertyVal && (transitionPropertyVal += ', ');
                    cssValues[transitionProperty] = transitionPropertyVal + cssProperty.join(', ');
                    var transitionDurationVal = dom.style[transitionDuration];
                    if (transitionDurationVal || parseInt(transitionDurationVal) === 0) {
                        transitionDurationVal += ', ';
                    }
                    cssValues[transitionDuration] = transitionDurationVal + duration + 's';
                    var transitionTimingVal = dom.style[transitionTiming];
                    transitionTimingVal && (transitionTimingVal += ', ');
                    cssValues[transitionTiming] = transitionTimingVal + ease;
                    var transitonDelayVal = dom.style[transitionDelay];
                    if (transitonDelayVal || parseInt(transitonDelayVal) === 0) {
                        transitonDelayVal += ', ';
                    }
                    cssValues[transitionDelay] = transitonDelayVal + delay + 's';
                }
                // 回调是否执行
                var fired = false;
                var setCss = Naboo.tool.setCss;
                // 包装后的回调函数
                var wrappedCallback = function (event) {
                    if (event && event.elapsedTime !== duration + delay) {
                        return;
                    }
                    if (typeof event !== 'undefined') {
                        if (event.target !== event.currentTarget) {
                            // 确保事件不是从底部冒泡上来的
                            return;
                        }
                        event.target.removeEventListener(transitionEnd, wrappedCallback);
                    } else {
                        // 由setTimeout触发
                        dom.removeEventListener(transitionEnd, wrappedCallback);
                    }
                    fired = true;
                    dom.setAttribute('data-naboo', +dom.getAttribute('data-naboo') - 1);
                    +dom.getAttribute('data-naboo') === 0 && setCss(dom, cssReset);
                    cb && cb();
                };
                duration > 0 && dom.addEventListener(transitionEnd, wrappedCallback);
                // 在某些老式的android手机上，transitionEnd事件有可能不会触发，这时候我们需要手动执行回调
                setTimeout(function () {
                    if (!fired) {
                        wrappedCallback();
                    }
                }, (duration + delay) * 1000 + 25);
                // 触发reflow让元素可以执行动画
                dom.clientLeft;
                setCss(dom, cssValues);
            }
        };
    }();
    /**
 * 专门用于执行动画的插件
 *
 * @param {Object} dom 要进行动画的dom对象
 * @param {Object} prop 要进行动画的css属性
 * @param {?Object} opt 动画的一些参数
 * @param {?number} opt.duration 动画时长，默认值400，单位ms
 * @param {?string} opt.ease 动画的缓动函数，可选值有'ease','ease-in','ease-out','linear','ease-in-out'，默认值'ease'
 * @param {?number} opt.delay 动画的延时时长，默认值0，单位ms
 * @param {?Function} opt.cb 动画的回调函数
 * @param {?string} opt.mode 动画的模式，可选值有'transition','keyframes(暂未支持)','js(暂未支持)'，默认值'transition'
 * @return {Object} 返回当前的naboo对象
 */
    Naboo.register('animate', function (next, dom, prop, opt) {
        opt = opt || {};
        var cb = opt.cb;
        opt.cb = function () {
            cb && cb();
            next();
        };
        opt.mode = ['transition'].indexOf(opt.mode) > -1 ? opt.mode : 'transition';
        Naboo[opt.mode](dom, prop, opt);
    });
    return Naboo;
});

// ======================
// src/dom/dom.js
// ======================


/**
 *
 * @file fixed element
 * @author qijian@baidu.com
 * @modify lilangbo@baidu.com 2017-06-06 upgrade to support asycn
 */
define('dom/dom', ['require'], function (require) {
    'use strict';
    /**
     * Save documentElement.
     * @inner
     * @type {Object}
     */
    var docElem = document.documentElement;
    /**
     * Get the supported matches method.
     * @inner
     * @type {Function}
     */
    var nativeMatches = docElem.matches || docElem.webkitMatchesSelector || docElem.mozMatchesSelector || docElem.oMatchesSelector || docElem.msMatchesSelector || docElem.matchesSelector;
    /**
     * Support for matches. Check whether a element matches a selector.
     * @param {HTMLElement} element
     * @param {string} selector
     * @return {boolean}
     */
    function matches(element, selector) {
        if (!element || element.nodeType !== 1) {
            return false;
        }
        return nativeMatches.call(element, selector);
    }
    /**
     * Support for closest. Find the closest parent node that matches the selector.
     * @param {HTMLElement} element
     * @param {string} selector
     * @return {?HTMLElement}
     */
    var closest = docElem.closest ? function (element, selector) {
        return element.closest(selector);
    } : function (element, selector) {
        while (element) {
            if (matches(element, selector)) {
                return element;
            }
            element = element.parentNode;
        }
        return null;
    };
    /**
     * Support for contains.
     * @param {HTMLElement} element
     * @param {HTMLElement} child
     * @return {boolean}
     */
    var contains = docElem.contains ? function (element, child) {
        return element && element.contains(child);
    } : function (element, child) {
        while (child) {
            if (element === child) {
                return true;
            }
            child = child.parentElement;
        }
        return false;
    };
    /**
     * Find the nearest element that matches the selector from current element to target element.
     * @param {HTMLElement} element
     * @param {string} selector
     * @param {HTMLElement} target
     * @return {?HTMLElement}
     */
    function closestTo(element, selector, target) {
        var closestElement = closest(element, selector);
        return contains(target, closestElement) ? closestElement : null;
    }
    /**
     * Temp element for creating element by string.
     * @inner
     * @type {HTMLElement}
     */
    var createTmpElement = document.createElement('div');
    /**
     * Create a element by string
     * @param {string} str Html string
     * @return {HTMLElement}
     */
    function create(str) {
        createTmpElement.innerHTML = str;
        if (!createTmpElement.children.length) {
            return null;
        }
        var children = Array.prototype.slice.call(createTmpElement.children);
        createTmpElement.innerHTML = '';
        return children.length > 1 ? children : children[0];
    }
    /**
     * Waits until the Document is ready. Then the
     * callback is executed.
     * @param {!Element} dom
     * @param {function()} callback
     */
    function waitDocumentReady(cb) {
        if (!!document.body) {
            cb();
            return;
        }
        var interval = window.setInterval(function () {
            if (!!document.body) {
                window.clearInterval(interval);
                cb();
            }
        }, 5);
    }
    return {
        closest: closest,
        closestTo: closestTo,
        matches: matches,
        contains: contains,
        create: create,
        waitDocumentReady: waitDocumentReady
    };
});

// ======================
// deps/fetch-jsonp.js
// ======================


(function (global, factory) {
    if (typeof define === 'function' && define.amd) {
        define('fetch-jsonp', [
            'exports',
            'module'
        ], factory);
    } else if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
        factory(exports, module);
    } else {
        var mod = { exports: {} };
        factory(mod.exports, mod);
        global.fetchJsonp = mod.exports;
    }
}(this, function (exports, module) {
    'use strict';
    var defaultOptions = {
        timeout: 5000,
        jsonpCallback: 'callback',
        jsonpCallbackFunction: null
    };
    function generateCallbackFunction() {
        return 'jsonp_' + Date.now() + '_' + Math.ceil(Math.random() * 100000);
    }
    // Known issue: Will throw 'Uncaught ReferenceError: callback_*** is not defined'
    // error if request timeout
    function clearFunction(functionName) {
        // IE8 throws an exception when you try to delete a property on window
        // http://stackoverflow.com/a/1824228/751089
        try {
            delete window[functionName];
        } catch (e) {
            window[functionName] = undefined;
        }
    }
    function removeScript(scriptId) {
        var script = document.getElementById(scriptId);
        document.getElementsByTagName('head')[0].removeChild(script);
    }
    function fetchJsonp(_url) {
        var options = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
        // to avoid param reassign
        var url = _url;
        var timeout = options.timeout || defaultOptions.timeout;
        var jsonpCallback = options.jsonpCallback || defaultOptions.jsonpCallback;
        var timeoutId = undefined;
        return new Promise(function (resolve, reject) {
            var callbackFunction = options.jsonpCallbackFunction || generateCallbackFunction();
            var scriptId = jsonpCallback + '_' + callbackFunction;
            window[callbackFunction] = function (response) {
                resolve({
                    ok: true,
                    // keep consistent with fetch API
                    json: function json() {
                        return Promise.resolve(response);
                    }
                });
                if (timeoutId)
                    clearTimeout(timeoutId);
                removeScript(scriptId);
                clearFunction(callbackFunction);
            };
            // Check if the user set their own params, and if not add a ? to start a list of params
            url += url.indexOf('?') === -1 ? '?' : '&';
            var jsonpScript = document.createElement('script');
            jsonpScript.setAttribute('src', '' + url + jsonpCallback + '=' + callbackFunction);
            jsonpScript.id = scriptId;
            document.getElementsByTagName('head')[0].appendChild(jsonpScript);
            timeoutId = setTimeout(function () {
                reject(new Error('JSONP request to ' + url + ' timed out'));
                clearFunction(callbackFunction);
                removeScript(scriptId);
            }, timeout);
        });
    }
    // export as global function
    /*
  let local;
  if (typeof global !== 'undefined') {
    local = global;
  } else if (typeof self !== 'undefined') {
    local = self;
  } else {
    try {
      local = Function('return this')();
    } catch (e) {
      throw new Error('polyfill failed because global object is unavailable in this environment');
    }
  }
  local.fetchJsonp = fetchJsonp;
  */
    module.exports = fetchJsonp;
}));

// ======================
// src/utils/fn.js
// ======================


define('utils/fn', ['require'], function (require) {
    'use strict';
    /**
     * Throttle a function.
     * @param {Function} fn
     * @param {number} delay The run time interval
     * @return {Function}
     */
    function throttle(fn, delay) {
        var context, args, timerId;
        var execTime = 0;
        !delay && (delay = 10);
        function exec() {
            timerId = 0;
            execTime = Date.now();
            fn.apply(context, args);
        }
        ;
        return function () {
            var delta = Date.now() - execTime;
            context = this;
            args = arguments;
            clearTimeout(timerId);
            if (delta >= delay) {
                exec();
            } else {
                timerId = setTimeout(exec, delay - delta);
            }
        };
    }
    /**
     * Get all values of an object.
     * @param {Object} obj
     * @return {Array}
     */
    function values(obj) {
        var keys = Object.keys(obj);
        var length = keys.length;
        var ret = [];
        for (var i = 0; i < length; i++) {
            ret.push(obj[keys[i]]);
        }
        return ret;
    }
    /**
     * Return an object is a plain object or not.
     * @param {Object} obj
     * @return {boolean}
     */
    function isPlainObject(obj) {
        return !!obj && Object.getPrototypeOf(obj) == Object.prototype;
    }
    /**
     * Extend an object to another object.
     * @inner
     * @param {Object} target
     * @param {Object} source
     * @param {boolean} deep Extend deeply
     */
    function _extend(target, source, deep) {
        for (var key in source) {
            if (deep) {
                if (isPlainObject(source[key])) {
                    !isPlainObject(target[key]) && (target[key] = {});
                } else if (Array.isArray(source[key])) {
                    !Array.isArray(target[key]) && (target[key] = []);
                } else {
                    source[key] !== undefined && (target[key] = source[key]);
                    continue;
                }
                _extend(target[key], source[key], deep);
            } else if (source[key] !== undefined) {
                target[key] = source[key];
            }
        }
    }
    /**
     * Extend some objects to an object.
     * @param {Object} target
     * @return {Object}
     */
    function extend(target) {
        var hasDeep = typeof target === 'boolean';
        var deep = false;
        if (hasDeep) {
            deep = target;
            target = arguments[1];
        }
        for (var i = hasDeep ? 2 : 1; i < arguments.length; i++) {
            _extend(target, arguments[i], deep);
        }
        return target;
    }
    /**
     * Pick some attributes from an object.
     * @param {Object} obj
     * @return {Object}
     */
    function pick(obj) {
        var keys = arguments[1];
        var result = {};
        if (!Array.isArray(keys)) {
            keys = Array.prototype.slice.call(arguments, 1);
        }
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (key in obj) {
                result[key] = obj[key];
            }
        }
        return result;
    }
    /**
     * If varible is string type
     *
     * @param {string} string params string
     * @return {boolean} whehter varible is string
     */
    function isString(string) {
        if (!string) {
            return false;
        }
        return Object.prototype.toString.call(string) === '[object String]';
    }
    /**
     * Empty a property
     *
     * @param {Object} obj object
     * @param {string} key key of object
     */
    function del(obj, key) {
        if (!obj || !obj[key]) {
            return;
        }
        try {
            delete obj[key];
        } catch (e) {
            obj[key] = undefined;
        }
    }
    /**
     * if window has Touch event(is mobile) or not (is PC)
     *
     * @return {boolean} if window has Touch event(is mobile) or not (is PC)
     */
    function hasTouch() {
        return 'ontouchstart' in window || window.navigator.maxTouchPoints !== undefined && window.navigator.maxTouchPoints > 0 || window.DocumentTouch !== undefined;
    }
    return {
        throttle: throttle,
        values: values,
        extend: extend,
        pick: pick,
        isPlainObject: isPlainObject,
        isString: isString,
        del: del,
        hasTouch: hasTouch
    };
});

// ======================
// src/dom/event.js
// ======================


define('dom/event', [
    'require',
    './dom'
], function (require) {
    'use strict';
    var dom = require('./dom');
    /**
     * Event delegator
     * @param {HTMLElement} element The parent node
     * @param {string} selector
     * @param {string} event Event name
     * @param {Function} handler
     * @param {boolean} capture
     */
    function delegate(element, selector, event, handler, capture) {
        capture = !!capture;
        function eventHandler(event) {
            var target = event.target;
            var parent = dom.closestTo(target, selector, this);
            if (parent) {
                handler.call(parent, event);
            }
        }
        ;
        element.addEventListener(event, eventHandler, capture);
        return function () {
            element.removeEventListener(event, eventHandler);
            eventHandler = element = handler = null;
        };
    }
    /**
     * Object for getting event's type.
     * @inner
     * @type {Object}
     */
    var specialEvents = {};
    specialEvents.click = specialEvents.mousedown = specialEvents.mouseup = specialEvents.mousemove = 'MouseEvents';
    /**
     * Create a event object to dispatch
     * @param {string} type Event name
     * @param {?Object} data Custom data
     * @return {Event}
     */
    function createEvent(type, data) {
        var event = document.createEvent(specialEvents[type] || 'Event');
        event.initEvent(type, true, true);
        data && (event.data = data);
        return event;
    }
    return {
        delegate: delegate,
        create: createEvent
    };
});

// ======================
// src/utils/platform.js
// ======================


/**
 * @file Platform Function. Support identification system, engine, browser type
 * @author wupeng10
 */
define('utils/platform', ['require'], function (require) {
    'use strict';
    /**
     * Platform class
     *
     * @class
     */
    function Platform() {
        // system
        this.isIos = false;
        this.isAndroid = false;
        // browser
        this.isWechatApp = false;
        this.isBaiduApp = false;
        this.isWeiboApp = false;
        this.isQQApp = false;
        this.isUc = false;
        this.isBaidu = false;
        this.isQQ = false;
        this.isAdr = false;
        this.isSafari = false;
        this.isChrome = false;
        this.isFireFox = false;
        // engine
        this.isTrident = false;
        this.isGecko = false;
        this.isWebkit = false;
    }
    /**
     * Judge system, iOS, android
     *
     */
    Platform.prototype._matchOs = function () {
        if (/iPhone|iPad|iPod/i.test(this._ua())) {
            this.isIos = true;
        } else if (/Android/i.test(this._ua())) {
            this.isAndroid = true;
        }
    };
    /**
     * Judge browser type
     *
     */
    Platform.prototype._matchBrowser = function () {
        var uaArray = this._ua().split('Mobile');
        var apps = uaArray && uaArray.length > 1 ? uaArray[1] : null;
        if (/\bmicromessenger\/([\d.]+)/i.test(apps)) {
            this.isWechatApp = true;
        } else if (/baiduboxapp/i.test(apps)) {
            this.isBaiduApp = true;
        } else if (/weibo/i.test(apps)) {
            this.isWeiboApp = true;
        } else if (/\sQQ/i.test(apps)) {
            this.isQQApp = true;
        } else if (/UCBrowser/i.test(this._ua())) {
            this.isUc = true;
        } else if (/baidubrowser/i.test(this._ua())) {
            this.isBaidu = true;
        } else if (/qqbrowser\/([0-9.]+)/i.test(this._ua())) {
            this.isQQ = true;
        } else if (!/android/i.test(this._ua()) && /\bversion\/([0-9.]+(?: beta)?)(?: mobile(?:\/[a-z0-9]+)?)? safari\//i.test(this._ua())) {
            this.isSafari = true;
        } else if (/(?:Chrome|CrMo|CriOS)\/([0-9]{1,2}\.[0-9]\.[0-9]{3,4}\.[0-9]+)/i.test(this._ua()) && !/samsung/i.test(this._ua())) {
            this.isChrome = true;
        } else if (/(firefox|FxiOS+)\/([0-9.ab]+)/i.test(this._ua())) {
            this.isFireFox = true;
        } else if (/android/i.test(this._ua()) && /Android[\s\_\-\/i686]?[\s\_\-\/](\d+[\.\-\_]\d+[\.\-\_]?\d*)/i.test(this._ua())) {
            this.isAdr = true;
        }
    };
    /**
     * Judge browser engine type
     *
     */
    Platform.prototype._matchEngine = function () {
        if (/\b(?:msie |ie |trident\/[0-9].*rv[ :])([0-9.]+)/i.test(this._ua())) {
            this.isTrident = true;
        } else if (/\brv:([\d\w.]+).*\bgecko\/(\d+)/i.test(this._ua())) {
            this.isGecko = true;
        } else if (/\bapplewebkit[\/]?([0-9.+]+)/i.test(this._ua())) {
            this.isWebkit = true;
        }
    };
    /**
     * OS Version
     *
     * @return {string}
     */
    Platform.prototype.getOsVersion = function () {
        var osVersion;
        var result;
        if (this.isAndroid()) {
            result = /Android ([\.\_\d]+)/.exec(this._ua()) || /Android\/([\d.]+)/.exec(this._ua());
            if (result && result.length > 1) {
                osVersion = result[1];
            }
        } else if (this.isIos()) {
            result = /OS (\d+)_(\d+)_?(\d+)?/.exec(this._appVersion());
            if (result && result.length > 3) {
                osVersion = result[1] + '.' + result[2] + '.' + (result[3] | 0);
            }
        }
        return osVersion;
    };
    /**
     * Wrap engine, browser, engine varible to function
     *
     */
    Platform.prototype._wrapFun = function () {
        var self = this;
        for (var key in self) {
            if (self.hasOwnProperty(key) && typeof self[key] !== 'function') {
                var handle = function (key) {
                    return key;
                }.bind(null, self[key]);
                self[key] = handle;
            }
        }
        self.needSpecialScroll = self.isIos() && window !== top;
    };
    /**
     * Get user agent
     *
     * @return {string} user agent
     */
    Platform.prototype._ua = function () {
        return navigator.userAgent;
    };
    /**
     * Get app version
     *
     * @return {string} app version
     */
    Platform.prototype._appVersion = function () {
        return navigator.appVersion;
    };
    /**
     * Start match user agent
     *
     * @return {Object} self object
     */
    Platform.prototype.start = function () {
        this._matchOs();
        this._matchBrowser();
        this._matchEngine();
        this._wrapFun();
        return this;
    };
    return new Platform();
});

// ======================
// src/dom/rect.js
// ======================


define('dom/rect', [
    'require',
    '../utils/platform'
], function (require) {
    'use strict';
    var platform = require('../utils/platform').start();
    // Save the native object or method.
    var docBody = document.body;
    var docElem = document.documentElement;
    var round = Math.round;
    /**
     * When page in IOS-IFRAME, scroll and rect have some bugs.
     * So we need add some elements to solve this problem.
     * @inner
     * @param {boolean} isEnd Create a ending element or not.
     * @return {?HTMLElement}
     */
    function patchForIOS(isEnd) {
        if (platform.needSpecialScroll && window !== top) {
            var element = document.createElement('div');
            element.style.cssText = isEnd ? 'position:absolute;width:0;height:0;visibility:hidden;' : 'position:absolute;top:0;left:0;width:0;height:0;visibility:hidden;';
            docBody.appendChild(element);
            return element;
        }
        return null;
    }
    /**
     * Element for getting scroll values.
     * @inner
     * @type {HTMLElement}
     */
    var getterElement = patchForIOS();
    /**
     * Element for setting scroll values.
     * @inner
     * @type {HTMLElement}
     */
    var setterElement = patchForIOS();
    /**
     * Element for get page height.
     * @inner
     * @type {HTMLElement}
     */
    var endElement = patchForIOS(true);
    /**
     * Browsers have some bugs in frame of IOS, the native getBoundingClientRect() also needs to recalculate,
     * so increase the "this" module.
     */
    var rect = {
        /**
         * Get rect by left,top,width,height.
         * @param {number} left
         * @param {number} top
         * @param {number} width
         * @param {number} height
         * @return {Object}
         */
        get: function (left, top, width, height) {
            left = round(left);
            top = round(top);
            width = round(width);
            height = round(height);
            return {
                left: left,
                top: top,
                width: width,
                height: height,
                right: left + width,
                bottom: top + height
            };
        },
        /**
         * The scrollingElement
         * @type {HTMLElement}
         */
        scrollingElement: document.scrollingElement || platform.isWebkit() && docBody || docElem,
        /**
         * Get an element's rect.
         * @param {HTMLElement} element
         * @return {Object}
         */
        getElementRect: function (element) {
            var clientRect = element.getBoundingClientRect();
            return this.get(clientRect.left + this.getScrollLeft(), clientRect.top + this.getScrollTop(), clientRect.width, clientRect.height);
        },
        /**
         * Get an element's offset.
         * @param {HTMLElement} element
         * @return {Object}
         */
        getElementOffset: function (element) {
            var clientRect = element.getBoundingClientRect();
            return {
                left: round(clientRect.left),
                top: round(clientRect.top),
                width: round(clientRect.width),
                height: round(clientRect.height)
            };
        },
        /**
         * Get scrollLeft
         * @return {number}
         */
        getScrollLeft: function () {
            return round(getterElement && -getterElement.getBoundingClientRect().left || this.scrollingElement.scrollLeft || pageXOffset || 0);
        },
        /**
         * Get scrollTop
         * @return {number}
         */
        getScrollTop: function () {
            return round(getterElement && -getterElement.getBoundingClientRect().top || this.scrollingElement.scrollTop || pageYOffset || 0);
        },
        /**
         * Set scrollTop
         * @param {number} top
         */
        setScrollTop: function (top) {
            if (setterElement) {
                setterElement.style.top = top + 'px';
                setterElement.scrollIntoView(true);
            } else {
                this.scrollingElement.scrollTop = top;
            }
        },
        /**
         * Get scrollHeight
         * @return {number}
         */
        getScrollHeight: function () {
            if (endElement && endElement != docBody.lastElementChild) {
                docBody.appendChild(endElement);
            }
            return round(endElement ? endElement.offsetTop : this.scrollingElement.scrollHeight);
        },
        /**
         * Get scrollWidth.
         * @return {number}
         */
        getScrollWidth: function () {
            return window.innerWidth;
        },
        /**
         * Whether two rect object are overlapped.
         * @param {Object} rect1
         * @param {Object} rect2
         * @return {boolean}
         */
        overlapping: function (rect1, rect2) {
            return rect1.top <= rect2.bottom && rect2.top <= rect1.bottom && rect1.left <= rect2.right && rect2.left <= rect1.right;
        }
    };
    return rect;
});

// ======================
// src/dom/css.js
// ======================


define('dom/css', ['require'], function (require) {
    'use strict';
    var camelReg = /(?:(^-)|-)+(.)?/g;
    /**
     * Temp element for checking css properties.
     */
    var supportElement = document.createElement('div');
    /**
     * Prefix type for browsers.
     * @const
     */
    var PREFIX_TYPE = [
        'webkit',
        'moz',
        'ms',
        'o',
        'Webkit',
        'Moz',
        'O'
    ];
    /**
     * Storage of css properties' prefix.
     */
    var prefixCache = {};
    /**
     * Make sure a property is supported by adding prefix.
     * @param {string} property A property to be checked
     * @return {string} the property or its prefixed version
     */
    function prefixProperty(property) {
        property = property.replace(camelReg, function (match, first, char) {
            return first ? char : char.toUpperCase();
        });
        if (prefixCache[property]) {
            return prefixCache[property];
        }
        if (!(property in supportElement.style)) {
            for (var i = 0; i < PREFIX_TYPE.length; i++) {
                var prefixedProp = PREFIX_TYPE[i] + property.charAt(0).toUpperCase() + property.slice(1);
                if (prefixedProp in supportElement.style) {
                    var prop = prefixedProp;
                    break;
                }
            }
        }
        return prefixCache[property] = prop || property;
    }
    /**
     * Regular expression of checking a string whether has a unit.
     * @const
     */
    var UNIT_REG = /^\d+([a-zA-Z]+)/;
    /**
     * Storage of css properties' units.
     */
    var unitCache = {};
    /**
     * Obtain the unit of a property and add it to the value has no unit if exists.
     * @param {string} property
     * @param {(string|number)} value A value maybe needs unit.
     * @return {(string|number)}
     */
    function unitProperty(property, value) {
        if (value !== +value) {
            return value;
        }
        if (unitCache[property]) {
            return value + unitCache[property];
        }
        supportElement.style[property] = 0;
        var propValue = supportElement.style[property];
        var match = propValue.match && propValue.match(UNIT_REG);
        if (match) {
            return value + (unitCache[property] = match[1]);
        }
        return value;
    }
    /**
     * Set or get the value of the style properties of an element or any elements.
     * Examples:
     *    css(elements, 'left', 0);
     *    css(element, 'left', 0);
     *    css(element, {left: 0, top: 0});
     *    css(element or elements, 'left'); // the value(s) of the computed left property of the element(s)
     * @param {(Array.<HTMLElement>|HTMLElement)} elements The source element(s)
     * @param {(Object|string)} property Object contains style properties or property name
     * @param {?(string|number)} value The value of setting property
     * @return {(Array.<HTMLElement>|HTMLElement|string)}
     */
    function css(elements, property, value) {
        var i;
        if (!property || !elements) {
            return elements;
        }
        ;
        if (elements.length && elements[0]) {
            if (property && value !== undefined) {
                for (i = 0; i < elements.length; i++) {
                    var element = elements[i];
                    css(element, property, value);
                }
                return elements;
            } else {
                var ret = [];
                for (i = 0; i < elements.length; i++) {
                    ret.push(css(elements[i], property));
                }
                return ret;
            }
        }
        if (!elements.nodeType) {
            return elements;
        }
        var element = elements;
        if (typeof property !== 'string' || value !== undefined) {
            var prop;
            if (typeof property === 'string') {
                prop = prefixProperty(property);
                element.style[prop] = unitProperty(prop, value);
            } else {
                for (i in property) {
                    value = property[i];
                    prop = prefixProperty(i);
                    element.style[prop] = unitProperty(prop, value);
                }
            }
            return element;
        } else {
            property = prefixProperty(property);
            return element.style[property] || document.defaultView.getComputedStyle(element)[property];
        }
    }
    return css;
});

// ======================
// src/utils/event-emitter.js
// ======================


define('utils/event-emitter', ['require'], function (require) {
    'use strict';
    /**
     * For determining whether a string is splitted by space or not.
     * @const
     * @inner
     * @type {RegExp}
     */
    var MULTI_REG = /\s+/;
    /**
     * If a string is splitted by space, convert string to array and
     * execute function N(n = Array.length) times with the args.
     * Return the result that the string is multiple or not.
     * @param {Object} obj The execute context
     * @param {Function} fn The function to be runned
     * @param {string} name 
     * @param {Array} args
     * @return {boolean}
     */
    function multiArgs(obj, fn, name, args) {
        if (MULTI_REG.test(name)) {
            var nameList = name.split(MULTI_REG);
            var isApply = typeof args !== 'function';
            for (var i = 0; i < nameList.length; i++) {
                isApply ? fn.apply(obj, [nameList[i]].concat(args)) : fn.call(obj, nameList[i], args);
            }
            return true;
        }
        return false;
    }
    /**
     * Custom event
     * @class
     * @param {?Object} opt Options
     */
    function EventEmitter(opt) {
        if (opt) {
            opt.context && this.setEventContext(opt.context);
            opt.createEventCallback && (this._createEventCallback = opt.createEventCallback);
            opt.removeEventCallback && (this._removeEventCallback = opt.removeEventCallback);
            opt.bindEventCallback && (this._bindEventCallback = opt.bindEventCallback);
        }
    }
    var proto = EventEmitter.prototype = {
        /**
         * Add handler to events
         * @param {string} name 
         * @param {Function} handler
         * @return {Object}
         */
        on: function (name, handler) {
            if (multiArgs(this, this.on, name, handler)) {
                return this;
            }
            this._getEvent(name).push(handler);
            this._bindEventCallback(name, handler);
            return this;
        },
        /**
         * Remove handler from events.
         * @param {?string} name
         * @param {?Function} handler
         * @return {?Object}
         */
        off: function (name, handler) {
            // If arguments` length is 0, remove all handlers.
            if (!name) {
                if (!handler) {
                    this.off(Object.keys(this.__events).join(' '), handler);
                }
                return null;
            }
            if (multiArgs(this, this.off, name, handler)) {
                return null;
            }
            if (handler) {
                var list = this._getEvent(name);
                var index = list.indexOf(handler);
                if (index > -1) {
                    list.splice(index, 1);
                }
            }
            if (!handler || list && list.length === 0) {
                delete this.__events[name];
                this._removeEventCallback(name);
            }
            return name ? this.__events && this.__events[name] : null;
        },
        /**
         * Add a one-off handler to events
         * @param {string} name
         * @param {Function} handler
         * @return {Function} the unbinder of the handler
         */
        once: function (name, handler) {
            var cb = handler.bind(this);
            var self = this;
            cb.__once = true;
            this.on(name, cb);
            return function () {
                self.off(name, cb);
                cb = self = null;
            };
        },
        /**
         * Trigger events.
         * @param {string} name
         */
        trigger: function (name) {
            var args = Array.prototype.slice.call(arguments, 1);
            if (multiArgs(this, this.trigger, name, args)) {
                return null;
            }
            var list = this._getEvent(name);
            var context = this.__eventContext || this;
            for (var i = 0; i < list.length; i++) {
                list[i].apply(context, args);
                if (list[i].__once) {
                    list.splice(i, 1);
                }
            }
        },
        /**
         * Set the handlers' context
         * @param {Function} context
         */
        setEventContext: function (context) {
            this.__eventContext = context || this;
        },
        /**
         * Get an event's handler list. If not exist, create it.
         * @param {string} name
         * @return {Object}
         */
        _getEvent: function (name) {
            if (!this.__events) {
                this.__events = {};
            }
            if (!this.__events[name]) {
                this.__events[name] = [];
                this._createEventCallback(name, this.__events[name]);
            }
            return this.__events[name];
        },
        /**
         * Called when an event is created.
         * @param {string} name Event name
         * @param {Array.<Function>} handlers The bound handlers
         */
        _createEventCallback: function (name, handlers) {
        },
        /**
         * Called when an event is removed.
         * @param {string} name Event name
         */
        _removeEventCallback: function (name) {
        },
        /**
         * Called when an event is binding.
         * @param {string} name Event name
         * @param {Function} handler Event handler
         */
        _bindEventCallback: function (name, handler) {
        }
    };
    [
        'on bind',
        'off unbind',
        'once one',
        'trigger fire emit'
    ].forEach(function (value) {
        var value = value.split(' ');
        for (var i = 1; i < value.length; i++) {
            proto[value[i]] = proto[value[0]];
        }
    });
    /**
     * Keys for extending to another object.
     * @inner
     * @type {Ojbect}
     */
    var keys = Object.keys(proto);
    /**
     * Mix EventEmitter's prototype into target object
     * @param {Object} obj
     * @return {Object}
     */
    EventEmitter.mixin = function (obj) {
        for (var i = 0; i < keys.length; i++) {
            if (!(keys[i] in obj)) {
                obj[keys[i]] = proto[keys[i]];
            }
        }
        return obj;
    };
    return EventEmitter;
});

// ======================
// src/utils/gesture/gesture-recognizer.js
// ======================


define('utils/gesture/gesture-recognizer', [
    'require',
    '../fn'
], function (require) {
    'use strict';
    var fn = require('../fn');
    // Save native functions.
    var abs = Math.abs;
    var create = Object.create;
    /**
     * Mean recognizer is at the beginning of the state.
     * @const
     * @inner
     * @type {number}
     */
    var STATE_START = 1;
    /**
     * Mean the recognizer is waitting timer or another recognizer. 
     * @const
     * @inner
     * @type {number}
     */
    var STATE_WAIT = 2;
    /**
     * Mean the recognizer is pending. Need to wait a while.
     * @const
     * @inner
     * @type {number}
     */
    var STATE_PENDING = 3;
    /**
     * Mean the recognizer can be emitted.
     * @const
     * @inner
     * @type {number}
     */
    var STATE_END = 4;
    /**
     * The state is failed or ended. Need to wait next life circle.
     * @const
     * @inner
     * @type {number}
     */
    var STATE_HOLD = 5;
    /**
     * This object is used to get state number fast.
     * @const
     * @inner
     * @type {Object}
     */
    var STATE_NUMBER = {
        'start': STATE_START,
        'wait': STATE_WAIT,
        'pending': STATE_PENDING,
        'end': STATE_END,
        'hold': STATE_HOLD
    };
    /**
     * Save the direction string, we will use it to get direction by number.
     * @const
     * @inner
     * @type {Object}
     */
    var DIRECTION_STR = {
        0: '',
        1: 'up',
        2: 'right',
        3: 'down',
        4: 'left'
    };
    /**
     * Recognizer class.
     * @class
     * @param {Gesture} gesture
     */
    function Recognizer(gesture) {
        /**
         * Sign the recognizer's state. Default is 'start'.
         * @private
         * @type {number}
         */
        this._state = STATE_START;
        /**
         * The bound gesture.
         * @type {Gesture}
         */
        this.gesture = gesture;
        /**
         * The conflicting list that records the conflicting recognizers in the same gesture object.
         * @type {Object}
         */
        this.conflictList = {};
    }
    fn.extend(Recognizer.prototype, /** @lends Recognizer.prototype **/
    {
        /**
         * Recognizer name.
         * @type {string}
         */
        name: '',
        /**
         * The event list of current recognizer.
         * @type {Array.<string>}
         */
        eventList: [],
        /**
         * Mark whether an automatic reset is required.
         * @type {boolean}
         */
        needAutoReset: true,
        /**
         * The conflicting level. When the recognizer is conflicted by another,
         * use it to decision which one is to hold.
         * @type {number}
         */
        level: 0,
        /**
         * Recognize event data.
         * @param {Object} data
         */
        recognize: function (data) {
            var eventState = data.eventState;
            if (eventState === 'start' && this._state === STATE_HOLD) {
                this._state = STATE_START;
                this.needAutoReset && this.reset();
            }
            if (this._state === STATE_HOLD) {
                return;
            }
            var state = this.process(data);
            if (this._state === STATE_HOLD) {
                return;
            }
            this._state = state;
            if (this.emitCheck()) {
                this.emit(data);
            }
        },
        /**
         * Determine that current recognizer is at [xxx] state or not.
         * Usage is isState(1, 5) or isState('start', 'hold'). It does not
         * limit the number of parameters.
         * @return {boolean}
         */
        isState: function () {
            var args = arguments;
            for (var i = 0; i < args.length; i++) {
                var st = typeof args[i] === 'string' ? STATE_NUMBER[args[i]] : args[i];
                if (st === this._state) {
                    return true;
                }
            }
            return false;
        },
        /**
         * Set state by string or number.
         * @param {string|number} st
         * @return {number}
         */
        setState: function (st) {
            st = typeof st === 'string' ? STATE_NUMBER[st] : st;
            if (st > 0 && st < 6) {
                this._state = st;
            }
            return this._state;
        },
        /**
         * Check whether the recognizer can be emitted.
         * @return {boolean}
         */
        emitCheck: function () {
            if (this._state === STATE_START || this._state === STATE_HOLD) {
                return false;
            }
            for (var i in this.conflictList) {
                var conflictRecognizer = this.conflictList[i];
                if (conflictRecognizer.level > this.level && this.conflictList[i].state !== STATE_HOLD) {
                    return false;
                }
            }
            return true;
        },
        /**
         * Process the event data. The main method of recognizer.
         * It needs to be overrode.
         * @param {Object} data
         * @return {number}
         */
        process: function (data) {
            return this._state;
        },
        /**
         * Emit with event data.
         * @param {Object} data
         */
        emit: function (data) {
        },
        /**
         * Reset the recognizer.
         */
        reset: function () {
        },
        /**
         * Put the state into hold.
         * @return {number}
         */
        hold: function () {
            return this._state = STATE_HOLD;
        },
        /**
         * Trigger the gesture's event.
         * @param {Object} data
         */
        trigger: function (data) {
            this.gesture.trigger(data.type, data.event, data);
        }
    });
    /**
     * For storing recognizers.
     * @inner
     * @type {Object}
     */
    var recognizerList = {};
    /**
     * For storing the event names of recognizers.
     * @inner
     * @type {Object}
     */
    var eventList = {};
    /**
     * Register also as the control of recognizers.
     * Recognizer.xxx means the control's method.
     * This method is used to register Recognizer class.
     * @param {Function} Rec
     * @param {string} name
     */
    Recognizer.register = function (Rec, name) {
        !Rec.conflictList && (Rec.conflictList = []);
        Rec.recName = Rec.prototype.recName = name;
        recognizerList[name] = Rec;
        var evlist = Rec.prototype.eventList;
        for (var i = 0; i < evlist.length; i++) {
            eventList[evlist[i]] = Rec;
        }
    };
    /**
     * Get the conflicting list of a recognizer class.
     * @param {string} name
     * @return {?Array.<Object>}
     */
    Recognizer.getConflictList = function (name) {
        return recognizerList[name] && recognizerList[name].conflictList;
    };
    /**
     * Get recognizer class by name.
     * @param {string} name
     * @return {Function}
     */
    Recognizer.get = function (name) {
        return recognizerList[name];
    };
    /**
     * Get recognizer class by event name.
     * @param {string} event Event name
     * @return {Function}
     */
    Recognizer.getByEventname = function (event) {
        return eventList[event];
    };
    /**
     * Conflict a and b.
     * @param {Function} a
     * @param {Function} b
     */
    Recognizer.conflict = function (a, b) {
        if (typeof a === 'string') {
            a = Recognizer.get(a);
            b = Recognizer.get(b);
        }
        if (!a || !b) {
            return;
        }
        a.conflictList.push(b.recName);
        b.conflictList.push(a.recName);
    };
    /* --------------    Recognizers  --------------- */
    /**
     * Handler for holdTime.
     */
    function holdTimeFn() {
        this._state = STATE_END;
        this.emit();
    }
    /**
     * Tap
     * @class
     */
    function TapRecognizer() {
        Recognizer.apply(this, arguments);
        this.boundHoldTimeFn = holdTimeFn.bind(this);
    }
    TapRecognizer.prototype = fn.extend(create(Recognizer.prototype), /** @lends TapRecognizer.prototype **/
    {
        /**
         * @override
         */
        eventList: ['tap'],
        /**
         * The count of tap.
         * @type {number}
         */
        taps: 1,
        /**
         * The count of user tap.
         * @type {number}
         */
        count: 0,
        /**
         * If the gesture has several tap recognizer,
         * we need to wait some time to recognize.
         * @type {number}
         */
        holdTime: 300,
        /**
         * The tap time. It will failed when the time is over this.
         * @type {number}
         */
        time: 250,
        /**
         * The move range of finger.
         * @type {number}
         */
        moveRange: 10,
        /**
         * @override
         */
        level: 1,
        /**
         * @override
         */
        needAutoReset: false,
        /**
         * Process the event data. The processing result are determined based on the data.
         * And return the result.
         * @override
         */
        process: function (data) {
            if (data.deltaTime > this.time || data.distance > this.moveRange || data.pointers.length > 1) {
                this.reset();
                return this.hold();
            }
            if (data.eventState === 'start') {
                clearTimeout(this.holdTimer);
            }
            if (data.eventState !== 'end') {
                return STATE_WAIT;
            }
            var holdTime = this.preTime && data.timeStamp - this.preTime;
            this.preTime = data.timeStamp;
            if (holdTime < this.holdTime) {
                this.count++;
            } else {
                this.count = 1;
            }
            this._data = data;
            if (this.count === this.taps) {
                if (this.emitCheck()) {
                    return STATE_END;
                } else {
                    this.holdTimer = setTimeout(this.boundHoldTimeFn, this.holdTime);
                    return STATE_WAIT;
                }
            }
        },
        /**
         * @override
         */
        reset: function () {
            this.preTime = null;
            this.count = 0;
            this._state = STATE_START;
            clearTimeout(this.holdTimer);
        },
        /**
         * @override
         */
        emit: function () {
            if (this._state === STATE_END) {
                var data = this._data;
                var eventData = create(data);
                eventData.type = this.eventList[0];
                this._data = null;
                this.trigger(eventData);
                this.reset();
            }
        }
    });
    /**
     * The double-tap-recognizer. It inherits from TapRecognizer.
     * @class
     */
    function DoubleTapRecognizer() {
        TapRecognizer.apply(this, arguments);
    }
    DoubleTapRecognizer.prototype = fn.extend(create(TapRecognizer.prototype), /** @lends DoubleRecognizer.prototype **/
    {
        /**
         * The tap number is 2.
         * @override
         */
        taps: 2,
        /**
         * @override
         */
        eventList: ['doubletap'],
        /**
         * The level is 2. Then, if a gesture has tap and doubletap, the doubletap is high level.
         * @override
         */
        level: 2
    });
    /**
     * Swipe recognizer.
     * @class
     */
    function SwipeRecognizer() {
        Recognizer.apply(this, arguments);
    }
    SwipeRecognizer.prototype = fn.extend(create(Recognizer.prototype), /** @lends SwipeRecognizer.prototype **/
    {
        /**
         * Swipe has 5 events. Swipe and another event will be triggered every time.
         * @override
         */
        eventList: [
            'swipe',
            'swipeup',
            'swiperight',
            'swipeleft',
            'swipedown'
        ],
        /**
         * The speed of finger.
         * @type {number}
         */
        velocity: 0.03,
        /**
         * Minimum distance.
         * @type {number}
         */
        distance: 30,
        /**
         * Time limit.
         * @type {number}
         */
        duration: 1000,
        /**
         * @override
         */
        process: function (data) {
            if (data.pointers.length > 1 || data.deltaTime > this.duration) {
                return STATE_HOLD;
            }
            if (data.eventState === 'end') {
                if (data.velocity >= this.velocity && data.distance > this.distance) {
                    return STATE_END;
                }
            }
        },
        /**
         * @override
         */
        emit: function (data) {
            if (this._state === STATE_END) {
                var dataSwipe = create(data);
                dataSwipe.type = 'swipe';
                dataSwipe.swipeDirection = DIRECTION_STR[data.direction];
                this.trigger(dataSwipe);
                var dataSwipeDir = create(data);
                dataSwipeDir.type = 'swipe' + DIRECTION_STR[data.direction];
                dataSwipeDir.swipeDirection = DIRECTION_STR[data.direction];
                this.trigger(dataSwipeDir);
            }
        }
    });
    Recognizer.register(TapRecognizer, 'tap');
    Recognizer.register(DoubleTapRecognizer, 'doubletap');
    Recognizer.register(SwipeRecognizer, 'swipe');
    Recognizer.conflict(DoubleTapRecognizer, TapRecognizer);
    return Recognizer;
});

// ======================
// src/utils/gesture/data-processor.js
// ======================


define('utils/gesture/data-processor', [], function () {
    'use strict';
    var round = Math.round;
    var max = Math.max;
    var abs = Math.abs;
    /**
     * Data processor of touch event object.
     * @type {Object}
     */
    var dataProcessor = {
        /**
         * The center point of starting gesture.
         * @type {?Object}
         */
        startCenter: null,
        /**
         * The center point of last gesture.
         * @type {?Object}
         */
        lastCenter: null,
        /**
         * The starting time of event.
         * @type {?number}
         */
        startTime: null,
        /**
         * Event data processor.
         * @param {Event} event
         * @param {boolean} preventX
         * @param {boolean} preventY
         * @return {Object}
         */
        process: function (event, preventX, preventY) {
            var data = {};
            var now = Date.now();
            var touches = event.touches.length ? event.touches : event.changedTouches;
            if (event.type === 'touchstart') {
                this.startCenter = this.getCenter(touches);
                this.startTime = now;
                this.startData = data;
                this.preData = null;
            }
            var startCenter = this.startCenter;
            var center = this.getCenter(touches);
            var deltaTime = data.deltaTime = now - this.startTime;
            data.pointers = touches;
            data.x = center.x;
            data.y = center.y;
            var deltaX = data.deltaX = center.x - startCenter.x;
            var deltaY = data.deltaY = center.y - startCenter.y;
            data.velocityX = deltaX / deltaTime || 0;
            data.velocityY = deltaY / deltaTime || 0;
            data.velocity = max(abs(data.velocityX), abs(data.velocityY));
            data.angle = this.getAngle(startCenter, center);
            data.distance = this.getDistance(startCenter, center);
            data.direction = this.getDirection(deltaX, deltaY);
            data.eventState = event.type.replace('touch', '');
            data.timeStamp = now;
            if (this.preData) {
                var instTime = data.instantDeltaTime = now - this.preData.timeStamp;
                var instX = data.instantVelocityX = (data.x - this.preData.x) / instTime || 0;
                var instY = data.instantVelocityY = (data.y - this.preData.y) / instTime || 0;
                if (data.eventState === 'move' && (preventX || preventY)) {
                    var curDirection = abs(instX) > abs(instY);
                    if (preventX && curDirection || preventY && !curDirection) {
                        event.preventDefault();
                    }
                }
            } else {
                data.instantDeltaTime = data.instantVelocityX = data.instantVelocityY = 0;
            }
            this.preData = data;
            data.event = event;
            return Object.freeze(data);
        },
        /**
         * Get the center point from some points.
         * TODO: Calculates the center point of multiple points.
         * @param {Array} points
         * @return {Object}
         */
        getCenter: function (points) {
            return {
                x: round(points[0].clientX),
                y: round(points[0].clientY)
            };
        },
        /**
         * Get the angle of two points.
         * @param {Object} point1
         * @Param {Object} point2
         * @return {number}
         */
        getAngle: function (point1, point2) {
            return Math.atan2(point2.y - point1.y, point2.x - point1.x) * 180 / Math.PI;
        },
        /**
         * Get the distance of two points.
         * @param {Object} point1
         * @param {Object} point2
         * @return {number}
         */
        getDistance: function (point1, point2) {
            var x = point2.x - point1.x;
            var y = point2.y - point1.y;
            return Math.sqrt(x * x + y * y);
        },
        /**
         * Calculate direction according to a coordinate.
         * The meaning of return values:         
         *  0: origin
         *  1: up
         *  2: right
         *  3: down
         *  4: left
         * @param {number} x
         * @param {number} y
         * @return {number}
         */
        getDirection: function (x, y) {
            if (x === y) {
                return 0;
            }
            if (abs(x) >= abs(y)) {
                return x > 0 ? 2 : 4;
            }
            return y < 0 ? 1 : 3;
        }
    };
    return dataProcessor;
});

// ======================
// src/utils/gesture.js
// ======================


define('utils/gesture', [
    'require',
    './event-emitter',
    './gesture/gesture-recognizer',
    './gesture/data-processor',
    './fn'
], function (require) {
    'use strict';
    var EventEmitter = require('./event-emitter');
    var Recognizer = require('./gesture/gesture-recognizer');
    var dataProcessor = require('./gesture/data-processor');
    var fn = require('./fn');
    /**
     * Handle touch event.
     * @inner
     * @param {Event} event
     */
    function touchHandler(event) {
        var opt = this._opt;
        opt.preventDefault && event.preventDefault();
        opt.stopPropagation && event.stopPropagation();
        var data = dataProcessor.process(event, opt.preventX, opt.preventY);
        this._recognize(data);
        this.trigger(event.type, event, data);
    }
    /**
     * Add or remove listeners from an element.
     * @inner
     * @param {HTMLElement} element
     * @param {string} events Events' name that are splitted by space
     * @param {Function} handler Event handler
     * @param {?boolean} method Add or remove.
     */
    function listenersHelp(element, events, handler, method) {
        var list = events.split(' ');
        for (var i = 0; i < list.length; i++) {
            if (method === false) {
                element.removeEventListener(list[i], handler);
            } else {
                element.addEventListener(list[i], handler, false);
            }
        }
    }
    /**
     * Gesture
     * @class
     * @param {HTMLElement} element Element that need gestures
     * @param {Object} opt Options
     */
    function Gesture(element, opt) {
        /**
         * The events' context.
         * @private
         * @type {?Object}
         */
        this.__eventContext = this._element = element;
        opt && (this._opt = fn.extend({}, this._opt, opt));
        /**
         * Touch handler.
         * @private
         * @type {Function}
         */
        this._boundTouchEvent = touchHandler.bind(this);
        listenersHelp(element, 'touchstart touchmove touchend touchcancel', this._boundTouchEvent);
        /**
         * For storing the recoginzers.
         * @private
         * @type {Object}
         */
        this._recognizers = {};
    }
    var proto = EventEmitter.mixin(Gesture.prototype);
    /**
     * Default options.
     * @private
     * @type {Object}
     */
    proto._opt = {
        preventDefault: false,
        stopPropagation: false,
        preventX: true,
        preventY: false
    };
    /**
     * Cleanup the events.
     */
    proto.cleanup = function () {
        var element = this._element;
        listenersHelp(element, 'touchstart touchmove touchend touchcancel', this._boundTouchEvent, false);
        this.off();
    };
    /**
     * Instantiate a recoginzer and add the recoginzer to the _recognizer and handle the conflicting list when
     * event is created.
     * @param {string} name
     */
    proto._createEventCallback = function (name) {
        if (this._hasRegister(name)) {
            return;
        }
        var RecognizerClass = Recognizer.getByEventname(name);
        if (!RecognizerClass) {
            return;
        }
        name = RecognizerClass.recName;
        var recognizer = this._recognizers[name] = new RecognizerClass(this);
        var conflictList = Recognizer.getConflictList(recognizer.recName);
        for (var i = 0; i < conflictList.length; i++) {
            name = conflictList[i];
            var conflictRecognizer = this._recognizers[name];
            if (conflictRecognizer) {
                conflictRecognizer.conflictList[recognizer.recName] = recognizer;
                recognizer.conflictList[conflictRecognizer.recName] = conflictRecognizer;
            }
        }
    };
    /**
     * When event is removed, cleanup the recognizer.
     * @param {string} name
     */
    proto._removeEventCallback = function (name) {
        var recognizer;
        if (name === undefined) {
            this._recognizers = {};
        } else if (recognizer = this._recognizers[name]) {
            for (var i in recognizer.conflictList) {
                delete recognizer.conflictList[i][name];
            }
            delete this._recognizers[name];
        }
    };
    /**
     * Determine whether a recognizer has been registered.
     * @param {string} name
     */
    proto._hasRegister = function (name) {
        return !!this._recognizers[Recognizer.getByEventname(name)];
    };
    /**
     * Recognize the gesture data.
     * @param {Object} data
     */
    proto._recognize = function (data) {
        var recognizers = this._recognizers;
        for (var i in recognizers) {
            var recognizer = recognizers[i];
            recognizer.recognize(data);
        }
    };
    return Gesture;
});

// ======================
// src/utils/customStorage.js
// ======================


/**
 * @file customStorage Function. Support publiser management and localstorage
 * @author wupeng10@baidu.com
 * @modify wupeng10@baidu.com 2017-03-02 Add cookieStorage module, In order to reduce http header
 * size, otherwise page will be a bad request with 40*,Need to be deleted after long-term solution;
 */
define('utils/customStorage', [
    'require',
    './fn'
], function (require) {
    'use strict';
    var fn = require('./fn');
    /**
     * Type of storage
     * @const
     * @inner
     * @type {Object}
     */
    var storageType = {
        LOCALSTORAGE: 0,
        ASYNCSTORAGE: 1,
        COOKIESTORAGE: 2
    };
    /**
     * Error code
     * @const
     * @inner
     * @type {Object}
     */
    var eCode = {
        siteExceed: 21,
        lsExceed: 22
    };
    /**
     * When no support local storage, store data temporary
     * @const
     * @inner
     * @type {Object}
     */
    var lsCache = {};
    /**
     * Location href
     * @const
     * @inner
     * @type {string}
     */
    var href = window.location.href;
    /**
     * Whether page in cache
     * @const
     * @inner
     * @type {boolean}
     */
    var isCachePage = false;
    /**
     * Domain of website
     * @const
     * @inner
     * @type {string}
     */
    var reg = /[a-zA-Z0-9][-a-zA-Z0-9]{0,62}(\.[a-zA-Z0-9][-a-zA-Z0-9]{0,62})+\.?/g;
    var matchArr = href.match(reg);
    var HOST = matchArr && matchArr.length > 1 ? matchArr[1] : '';
    /**
     * Current domain storage size, max is 4k
     * @const
     * @inner
     * @type {number}
     */
    var STORAGESIZE = 4 * 1024;
    /**
     * Update local storage operation time
     *
     * @param {Object} storage it's local storage
     */
    function updateTime(storage) {
        if (!storage) {
            return;
        }
        storage.u = new Date().getTime();
    }
    /**
     * Parse json link JSON.parse
     *
     * @param {string} str parse string
     * @return {string} parsed string
     */
    function parseJson(str) {
        try {
            str = JSON.parse(str);
        } catch (e) {
            str = JSON.stringify(str);
            str = JSON.parse(str);
        }
        return str;
    }
    /**
     * Get error message with error code
     *
     * @param {string} code error code
     * @param {string} name error name
     * @return {string} error message
     */
    function getErrorMess(code, name) {
        var mess;
        switch (code) {
        case eCode.siteExceed:
            mess = 'storage space need less than 4k';
        case eCode.lsExceed:
            mess = 'Uncaught DOMException: Failed to execute setItem on Storage: Setting the value of ' + name + ' exceeded the quota at ' + window.location.href;
        }
        return mess;
    }
    /**
     * Generate error object
     *
     * @param {string} code error code
     * @param {string} mess error name
     * @return {string} error object
     */
    function getError(code, mess) {
        return {
            errCode: code,
            errMess: mess
        };
    }
    /**
     * Storage Class
     *
     * @param {number} type type of storage
     * @class
     */
    function customStorage(type) {
        switch (type) {
        case storageType.ASYNCSTORAGE:
            this.storage = new AsyncStorage();
            break;
        case storageType.LOCALSTORAGE:
            this.storage = new LocalStorage();
            this.storage._isCachePage(href);
            break;
        case storageType.COOKIESTORAGE:
            this.storage = new CookieStorage();
            break;
        }
        return this.storage;
    }
    /**
     * Local Storage class
     *
     * @class
     */
    function LocalStorage() {
    }
    /**
     * Whether support Local Storage
     *
     * @return {boolean} Whether support ls
     */
    LocalStorage.prototype._supportLs = function () {
        var support = false;
        if (window.localStorage && window.localStorage.setItem) {
            try {
                window.localStorage.setItem('lsExisted', '1');
                window.localStorage.removeItem('lsExisted');
                support = true;
            } catch (e) {
                support = false;
            }
        }
        return support;
    };
    /**
     * Get local storage
     *
     * @return {Object} value of local storage
     */
    LocalStorage.prototype._getLocalStorage = function () {
        var ls = this._supportLs() ? localStorage.getItem(HOST) : lsCache[HOST];
        ls = ls ? parseJson(ls) : {};
        updateTime(ls);
        return ls;
    };
    /**
     * Delete local storage
     *
     * @param {string} key the key of local storage
     */
    LocalStorage.prototype._rmLocalStorage = function (key) {
        if (!key) {
            key = HOST;
        }
        this._supportLs() ? localStorage.removeItem(key) : fn.del(lsCache, key);
    };
    /**
     * Set current site data in local storage
     *
     * @param {string} name name of storage
     * @param {string} value value of storage
     * @param {string} expire optional
     * @param {string} callback if error callback to publisher
     */
    LocalStorage.prototype.set = function (name, value, expire, callback) {
        if (!name || !value) {
            return;
        }
        callback = typeof expire === 'function' ? expire : callback;
        if (isCachePage) {
            var ls = this._getLocalStorage();
            ls[name] = value;
            expire = parseInt(expire, 10);
            if (!isNaN(expire) && expire > 0) {
                ls.e = new Date().getTime() + expire;
            } else {
                fn.del(ls, 'e');
            }
            ls = JSON.stringify(ls);
            if (ls.length > STORAGESIZE) {
                callback && callback(getError(eCode.siteExceed, getErrorMess(eCode.siteExceed)));
                throw getErrorMess(eCode.siteExceed);
            }
            this._setLocalStorage(HOST, ls, expire, callback);
        } else {
            this._setLocalStorage(name, value, expire, callback);
        }
    };
    /**
     * Set local storage
     *
     * @param {string} key the key of local storage
     * @param {string} value the key of local storage
     * @param {string} expire the expire of local storage
     * @param {string} callback if error callback to publisher
     */
    LocalStorage.prototype._setLocalStorage = function (key, value, expire, callback) {
        var mess = getErrorMess(eCode.lsExceed, key);
        callback = typeof expire === 'function' ? expire : callback;
        if (this._supportLs()) {
            try {
                localStorage.setItem(key, value);
            } catch (e) {
                if (this._isExceed(e) && isCachePage) {
                    this._exceedHandler(key, value, expire);
                } else if (this._isExceed(e) && !isCachePage) {
                    callback && callback(getError(eCode.lsExceed, mess));
                    throw mess;
                }
            }
        } else {
            var size = value.length / 1024 / 1024;
            for (var k in lsCache) {
                if (lsCache[k]) {
                    size += lsCache[k].length / 1024 / 1024;
                }
            }
            if (size > 5) {
                callback && callback(eCode.lsExceed, mess);
                throw mess;
            }
            lsCache[key] = value;
        }
    };
    /**
     * Get current site data in local storage
     *
     * @param {string} name name of storage
     * @return {string} get data with key
     */
    LocalStorage.prototype.get = function (name) {
        if (!fn.isString(name)) {
            return;
        }
        var result;
        if (isCachePage) {
            var ls = this._getLocalStorage();
            if (ls && ls[name]) {
                result = ls[name];
            }
        } else {
            result = this._supportLs() ? localStorage.getItem(name) : lsCache[name];
        }
        return result;
    };
    /**
     * Delete current site data in local storage with key
     *
     * @param {string} name name of storage
     */
    LocalStorage.prototype.rm = function (name) {
        if (!fn.isString(name)) {
            return;
        }
        if (isCachePage) {
            var ls = this._getLocalStorage();
            if (ls && ls[name]) {
                fn.del(ls, name);
                this._setLocalStorage(HOST, JSON.stringify(ls));
            }
        } else {
            this._supportLs() ? localStorage.removeItem(name) : fn.del(lsCache, name);
        }
    };
    /**
     * Clear current site local storage
     *
     */
    LocalStorage.prototype.clear = function () {
        if (isCachePage) {
            this._rmLocalStorage();
        } else {
            this._supportLs() ? localStorage.clear() : lsCache = {};
        }
    };
    /**
     * Delete all expire storage, scope is all sites
     *
     * @return {boolean} whether storage has expired
     */
    LocalStorage.prototype.rmExpires = function () {
        var hasExpires = false;
        if (isCachePage) {
            var ls = this._supportLs() ? localStorage : lsCache;
            for (var k in ls) {
                if (ls[k]) {
                    var val;
                    if (typeof ls[k] === 'string') {
                        val = parseJson(ls[k]);
                    }
                    if (val && val.e) {
                        var expire = parseInt(parseJson(ls[k]).e, 10);
                        if (expire && new Date().getTime() >= expire) {
                            hasExpires = true;
                            this._rmLocalStorage(k);
                        }
                    }
                }
            }
        }
        return hasExpires;
    };
    /**
     * Whether local storage is exceed, http://crocodillon.com/blog/always-catch-localstorage-security-and-quota-exceeded-errors
     *
     * @param {Object} e set local storage error
     * @return {boolean} whether storage exceed
     */
    LocalStorage.prototype._isExceed = function (e) {
        var quotaExceeded = false;
        if (e && e.code) {
            switch (e.code) {
            case 22: {
                    quotaExceeded = true;
                    break;
                }
            case 1014: {
                    // Firefox
                    quotaExceeded = e.name === 'NS_ERROR_DOM_QUOTA_REACHED';
                    break;
                }
            }
        } else if (e && e.number === -2147024882) {
            // Internet Explorer 8
            quotaExceeded = true;
        }
        return quotaExceeded;
    };
    /**
     * Handle when storage exceed
     *
     * @param {string} name the key of local storage
     * @param {string} value the key of local storage
     * @param {string} expire the expire of local storage
     */
    LocalStorage.prototype._exceedHandler = function (name, value, expire) {
        var minTimeStamp;
        var key;
        if (!this.rmExpires()) {
            var ls = localStorage;
            for (var k in ls) {
                if (ls[k]) {
                    var item = parseJson(ls[k]).u;
                    if (!key || parseInt(item, 10) < minTimeStamp) {
                        key = k;
                        minTimeStamp = parseInt(item, 10);
                    }
                }
            }
            this._rmLocalStorage(key);
        }
        this.set(name, value, expire);
    };
    /**
     * If page is cache page
     *
     * @param {string} href page href
     */
    LocalStorage.prototype._isCachePage = function (href) {
        isCachePage = /mipcache.bdstatic.com/.test(href) || /c.mipcdn.com/.test(href);
    };
    /**
     * Publisher manage storage, via request
     *
     * @class
     */
    function AsyncStorage() {
    }
    /**
     * Send request to server with params
     *
     * @param {Object} opt request params
     */
    AsyncStorage.prototype.request = function (opt) {
        if (!opt || !opt.url) {
            return;
        }
        var myInit = {};
        myInit.mode = opt.mode ? opt.mode : null;
        myInit.method = opt.method ? opt.method : 'GET';
        myInit.credentials = opt.credentials ? opt.credentials : 'omit';
        myInit.cache = opt.cache ? opt.cache : 'default';
        if (opt.headers) {
            myInit.headers = opt.headers;
        }
        if (opt.body) {
            myInit.body = opt.body;
        }
        fetch(opt.url, myInit).then(function (res) {
            if (res.ok) {
                res.text().then(function (data) {
                    opt.success && opt.success(JSON.parse(data));
                });
            } else {
                opt.error && opt.error(res);
            }
        }).catch(function (err) {
            opt.error && opt.error(err);
        });
    };
    /**
     * Cookie storage
     *
     * @class
     */
    function CookieStorage() {
    }
    /**
     * Delete exceed cookie storage
     *
     * @param {Object} opt request params
     */
    CookieStorage.prototype.delExceedCookie = function () {
        var cks = document.cookie;
        var cksLen = cks.length;
        var MINSIZE = 3 * 1024;
        var MAXSIZE = 5 * 1024;
        if (cksLen >= MAXSIZE) {
            var items = cks.split(';');
            for (var i = 0; i < items.length; i++) {
                var item = items[i].split('=');
                if (item && item.length > 1) {
                    cksLen -= items[i].length;
                    var exp = new Date();
                    exp.setTime(exp.getTime() - 1000);
                    document.cookie = item[0] + '=' + item[1] + ';expires=' + exp.toGMTString();
                }
                if (cksLen <= MINSIZE) {
                    break;
                }
            }
        }
    };
    return customStorage;
});

// ======================
// src/util.js
// ======================


/**
 *
 * @file export api
 * @author xx
 * @modify wupeng10@baidu.com 2017-06-15 add parseCacheUrl api
 */
define('util', [
    'require',
    './utils/fn',
    './dom/dom',
    './dom/event',
    './dom/rect',
    './dom/css',
    './utils/gesture',
    './utils/event-emitter',
    './utils/platform',
    './utils/customStorage',
    'naboo'
], function (require) {
    'use strict';
    // Page url
    var pageUrl = location.href;
    /**
     * Exchange a url to cache url.
     *
     * @param {string} url Source url.
     * @param {string} type The url type.
     * @return {string} Cache url.
     */
    function makeCacheUrl(url, type) {
        if (pageUrl.indexOf('mipcache.bdstatic.com') < 0 || url && url.length < 8 || !(url.indexOf('http') === 0 || url.indexOf('//') === 0)) {
            return url;
        }
        var prefix = type === 'img' ? '/i/' : '/c/';
        if (url.indexOf('//') === 0 || url.indexOf('https') === 0) {
            prefix += 's/';
        }
        var urlParas = url.split('//');
        urlParas.shift();
        url = urlParas.join('//');
        return prefix + url;
    }
    /**
     * Exchange cache url to origin url.
     * Reg result has many aspects, it's following
     *  reg[0] whole url
     *  reg[1] url protocol
     *  reg[2] url mip cache domain
     *  reg[3] url domain extname
     *  reg[4] /s flag
     *  reg[5] origin url
     *
     * @param {string} url Source url.
     * @return {string} origin url.
     */
    function parseCacheUrl(url) {
        if (!url) {
            return;
        }
        if (!(url.indexOf('http') === 0 || url.indexOf('/') === 0)) {
            return url;
        }
        var reg = new RegExp('^(http[s]:){0,1}(//[a-zA-Z0-9][-a-zA-Z0-9]{0,62}' + '(.[a-zA-Z0-9][-a-zA-Z0-9]{0,62})+.?){0,1}/[ic](/s){0,1}/(.*)$', 'g');
        var result = reg.exec(url);
        if (!result) {
            return url;
        }
        var uri = result[4] ? 'https:' : 'http:';
        uri += result[5] ? '//' + result[5] : '';
        var urlRegExp = /http(s)?:\/\/([\w-]+\.)+[\w-]+(\/[\w- .\/?%&=]*)?/;
        if (!urlRegExp.test(uri)) {
            return url;
        }
        return uri;
    }
    return {
        parseCacheUrl: parseCacheUrl,
        makeCacheUrl: makeCacheUrl,
        fn: require('./utils/fn'),
        dom: require('./dom/dom'),
        event: require('./dom/event'),
        rect: require('./dom/rect'),
        css: require('./dom/css'),
        Gesture: require('./utils/gesture'),
        EventEmitter: require('./utils/event-emitter'),
        platform: require('./utils/platform').start(),
        customStorage: require('./utils/customStorage'),
        naboo: require('naboo')
    };
});

// ======================
// deps/fetch.js
// ======================


define('fetch', [
    'require',
    'util'
], function (require) {
    'use strict';
    function vendorAccess() {
        var platform = require('util').platform;
        if (platform.isQQ()) {
            return false;
        }
        return true;
    }
    if (self.fetch && vendorAccess()) {
        return;
    }
    var support = {
        searchParams: 'URLSearchParams' in self,
        iterable: 'Symbol' in self && 'iterator' in Symbol,
        blob: 'FileReader' in self && 'Blob' in self && function () {
            try {
                new Blob();
                return true;
            } catch (e) {
                return false;
            }
        }(),
        formData: 'FormData' in self,
        arrayBuffer: 'ArrayBuffer' in self
    };
    if (support.arrayBuffer) {
        var viewClasses = [
            '[object Int8Array]',
            '[object Uint8Array]',
            '[object Uint8ClampedArray]',
            '[object Int16Array]',
            '[object Uint16Array]',
            '[object Int32Array]',
            '[object Uint32Array]',
            '[object Float32Array]',
            '[object Float64Array]'
        ];
        var isDataView = function (obj) {
            return obj && DataView.prototype.isPrototypeOf(obj);
        };
        var isArrayBufferView = ArrayBuffer.isView || function (obj) {
            return obj && viewClasses.indexOf(Object.prototype.toString.call(obj)) > -1;
        };
    }
    function normalizeName(name) {
        if (typeof name !== 'string') {
            name = String(name);
        }
        if (/[^a-z0-9\-#$%&'*+.\^_`|~]/i.test(name)) {
            throw new TypeError('Invalid character in header field name');
        }
        return name.toLowerCase();
    }
    function normalizeValue(value) {
        if (typeof value !== 'string') {
            value = String(value);
        }
        return value;
    }
    // Build a destructive iterator for the value list
    function iteratorFor(items) {
        var iterator = {
            next: function () {
                var value = items.shift();
                return {
                    done: value === undefined,
                    value: value
                };
            }
        };
        if (support.iterable) {
            iterator[Symbol.iterator] = function () {
                return iterator;
            };
        }
        return iterator;
    }
    function Headers(headers) {
        this.map = {};
        if (headers instanceof Headers) {
            headers.forEach(function (value, name) {
                this.append(name, value);
            }, this);
        } else if (headers) {
            Object.getOwnPropertyNames(headers).forEach(function (name) {
                this.append(name, headers[name]);
            }, this);
        }
    }
    Headers.prototype.append = function (name, value) {
        name = normalizeName(name);
        value = normalizeValue(value);
        var oldValue = this.map[name];
        this.map[name] = oldValue ? oldValue + ',' + value : value;
    };
    Headers.prototype['delete'] = function (name) {
        delete this.map[normalizeName(name)];
    };
    Headers.prototype.get = function (name) {
        name = normalizeName(name);
        return this.has(name) ? this.map[name] : null;
    };
    Headers.prototype.has = function (name) {
        return this.map.hasOwnProperty(normalizeName(name));
    };
    Headers.prototype.set = function (name, value) {
        this.map[normalizeName(name)] = normalizeValue(value);
    };
    Headers.prototype.forEach = function (callback, thisArg) {
        for (var name in this.map) {
            if (this.map.hasOwnProperty(name)) {
                callback.call(thisArg, this.map[name], name, this);
            }
        }
    };
    Headers.prototype.keys = function () {
        var items = [];
        this.forEach(function (value, name) {
            items.push(name);
        });
        return iteratorFor(items);
    };
    Headers.prototype.values = function () {
        var items = [];
        this.forEach(function (value) {
            items.push(value);
        });
        return iteratorFor(items);
    };
    Headers.prototype.entries = function () {
        var items = [];
        this.forEach(function (value, name) {
            items.push([
                name,
                value
            ]);
        });
        return iteratorFor(items);
    };
    if (support.iterable) {
        Headers.prototype[Symbol.iterator] = Headers.prototype.entries;
    }
    function consumed(body) {
        if (body.bodyUsed) {
            return Promise.reject(new TypeError('Already read'));
        }
        body.bodyUsed = true;
    }
    function fileReaderReady(reader) {
        return new Promise(function (resolve, reject) {
            reader.onload = function () {
                resolve(reader.result);
            };
            reader.onerror = function () {
                reject(reader.error);
            };
        });
    }
    function readBlobAsArrayBuffer(blob) {
        var reader = new FileReader();
        var promise = fileReaderReady(reader);
        reader.readAsArrayBuffer(blob);
        return promise;
    }
    function readBlobAsText(blob) {
        var reader = new FileReader();
        var promise = fileReaderReady(reader);
        reader.readAsText(blob);
        return promise;
    }
    function readArrayBufferAsText(buf) {
        var view = new Uint8Array(buf);
        var chars = new Array(view.length);
        for (var i = 0; i < view.length; i++) {
            chars[i] = String.fromCharCode(view[i]);
        }
        return chars.join('');
    }
    function bufferClone(buf) {
        if (buf.slice) {
            return buf.slice(0);
        } else {
            var view = new Uint8Array(buf.byteLength);
            view.set(new Uint8Array(buf));
            return view.buffer;
        }
    }
    function Body() {
        this.bodyUsed = false;
        this._initBody = function (body) {
            this._bodyInit = body;
            if (!body) {
                this._bodyText = '';
            } else if (typeof body === 'string') {
                this._bodyText = body;
            } else if (support.blob && Blob.prototype.isPrototypeOf(body)) {
                this._bodyBlob = body;
            } else if (support.formData && FormData.prototype.isPrototypeOf(body)) {
                this._bodyFormData = body;
            } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
                this._bodyText = body.toString();
            } else if (support.arrayBuffer && support.blob && isDataView(body)) {
                this._bodyArrayBuffer = bufferClone(body.buffer);
                // IE 10-11 can't handle a DataView body.
                this._bodyInit = new Blob([this._bodyArrayBuffer]);
            } else if (support.arrayBuffer && (ArrayBuffer.prototype.isPrototypeOf(body) || isArrayBufferView(body))) {
                this._bodyArrayBuffer = bufferClone(body);
            } else {
                throw new Error('unsupported BodyInit type');
            }
            if (!this.headers.get('content-type')) {
                if (typeof body === 'string') {
                    this.headers.set('content-type', 'text/plain;charset=UTF-8');
                } else if (this._bodyBlob && this._bodyBlob.type) {
                    this.headers.set('content-type', this._bodyBlob.type);
                } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
                    this.headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
                }
            }
        };
        if (support.blob) {
            this.blob = function () {
                var rejected = consumed(this);
                if (rejected) {
                    return rejected;
                }
                if (this._bodyBlob) {
                    return Promise.resolve(this._bodyBlob);
                } else if (this._bodyArrayBuffer) {
                    return Promise.resolve(new Blob([this._bodyArrayBuffer]));
                } else if (this._bodyFormData) {
                    throw new Error('could not read FormData body as blob');
                } else {
                    return Promise.resolve(new Blob([this._bodyText]));
                }
            };
            this.arrayBuffer = function () {
                if (this._bodyArrayBuffer) {
                    return consumed(this) || Promise.resolve(this._bodyArrayBuffer);
                } else {
                    return this.blob().then(readBlobAsArrayBuffer);
                }
            };
        }
        this.text = function () {
            var rejected = consumed(this);
            if (rejected) {
                return rejected;
            }
            if (this._bodyBlob) {
                return readBlobAsText(this._bodyBlob);
            } else if (this._bodyArrayBuffer) {
                return Promise.resolve(readArrayBufferAsText(this._bodyArrayBuffer));
            } else if (this._bodyFormData) {
                throw new Error('could not read FormData body as text');
            } else {
                return Promise.resolve(this._bodyText);
            }
        };
        if (support.formData) {
            this.formData = function () {
                return this.text().then(decode);
            };
        }
        this.json = function () {
            return this.text().then(JSON.parse);
        };
        return this;
    }
    // HTTP methods whose capitalization should be normalized
    var methods = [
        'DELETE',
        'GET',
        'HEAD',
        'OPTIONS',
        'POST',
        'PUT'
    ];
    function normalizeMethod(method) {
        var upcased = method.toUpperCase();
        return methods.indexOf(upcased) > -1 ? upcased : method;
    }
    function Request(input, options) {
        options = options || {};
        var body = options.body;
        if (typeof input === 'string') {
            this.url = input;
        } else {
            if (input.bodyUsed) {
                throw new TypeError('Already read');
            }
            this.url = input.url;
            this.credentials = input.credentials;
            if (!options.headers) {
                this.headers = new Headers(input.headers);
            }
            this.method = input.method;
            this.mode = input.mode;
            if (!body && input._bodyInit != null) {
                body = input._bodyInit;
                input.bodyUsed = true;
            }
        }
        this.credentials = options.credentials || this.credentials || 'omit';
        if (options.headers || !this.headers) {
            this.headers = new Headers(options.headers);
        }
        this.method = normalizeMethod(options.method || this.method || 'GET');
        this.mode = options.mode || this.mode || null;
        this.referrer = null;
        if ((this.method === 'GET' || this.method === 'HEAD') && body) {
            throw new TypeError('Body not allowed for GET or HEAD requests');
        }
        this._initBody(body);
    }
    Request.prototype.clone = function () {
        return new Request(this, { body: this._bodyInit });
    };
    function decode(body) {
        var form = new FormData();
        body.trim().split('&').forEach(function (bytes) {
            if (bytes) {
                var split = bytes.split('=');
                var name = split.shift().replace(/\+/g, ' ');
                var value = split.join('=').replace(/\+/g, ' ');
                form.append(decodeURIComponent(name), decodeURIComponent(value));
            }
        });
        return form;
    }
    function parseHeaders(rawHeaders) {
        var headers = new Headers();
        rawHeaders.split('\r\n').forEach(function (line) {
            var parts = line.split(':');
            var key = parts.shift().trim();
            if (key) {
                var value = parts.join(':').trim();
                headers.append(key, value);
            }
        });
        return headers;
    }
    Body.call(Request.prototype);
    function Response(bodyInit, options) {
        if (!options) {
            options = {};
        }
        this.type = 'default';
        this.status = 'status' in options ? options.status : 200;
        this.ok = this.status >= 200 && this.status < 300;
        this.statusText = 'statusText' in options ? options.statusText : 'OK';
        this.headers = new Headers(options.headers);
        this.url = options.url || '';
        this._initBody(bodyInit);
    }
    Body.call(Response.prototype);
    Response.prototype.clone = function () {
        return new Response(this._bodyInit, {
            status: this.status,
            statusText: this.statusText,
            headers: new Headers(this.headers),
            url: this.url
        });
    };
    Response.error = function () {
        var response = new Response(null, {
            status: 0,
            statusText: ''
        });
        response.type = 'error';
        return response;
    };
    var redirectStatuses = [
        301,
        302,
        303,
        307,
        308
    ];
    Response.redirect = function (url, status) {
        if (redirectStatuses.indexOf(status) === -1) {
            throw new RangeError('Invalid status code');
        }
        return new Response(null, {
            status: status,
            headers: { location: url }
        });
    };
    self.Headers = Headers;
    self.Request = Request;
    self.Response = Response;
    self.fetch = function (input, init) {
        return new Promise(function (resolve, reject) {
            var request = new Request(input, init);
            var xhr = new XMLHttpRequest();
            xhr.onload = function () {
                var options = {
                    status: xhr.status,
                    statusText: xhr.statusText,
                    headers: parseHeaders(xhr.getAllResponseHeaders() || '')
                };
                options.url = 'responseURL' in xhr ? xhr.responseURL : options.headers.get('X-Request-URL');
                var body = 'response' in xhr ? xhr.response : xhr.responseText;
                resolve(new Response(body, options));
            };
            xhr.onerror = function () {
                reject(new TypeError('Network request failed'));
            };
            xhr.ontimeout = function () {
                reject(new TypeError('Network request failed'));
            };
            xhr.open(request.method, request.url, true);
            if (request.credentials === 'include') {
                xhr.withCredentials = true;
            }
            if ('responseType' in xhr && support.blob) {
                xhr.responseType = 'blob';
            }
            request.headers.forEach(function (value, name) {
                xhr.setRequestHeader(name, value);
            });
            xhr.send(typeof request._bodyInit === 'undefined' ? null : request._bodyInit);
        });
    };
    self.fetch.polyfill = true;
});

// ======================
// src/utils/event-action.js
// ======================


define('utils/event-action', [
    'require',
    './fn',
    '../dom/dom'
], function (require) {
    'use strict';
    var fn = require('./fn');
    var dom = require('../dom/dom');
    /**
     * Regular for parsing params.
     * @const
     * @inner
     * @type {RegExp}
     */
    var PARSE_REG = /^(\w+):([\w-]+)\.([\w-]+)(?:\(([^\)]+)\))?$/;
    /**
     * Regular for checking elements.
     * @const
     * @inner
     * @type {RegExp}
     */
    var CHECK_REG = /^mip-/;
    /**
     * Key list of picking options.
     * @const
     * @inner
     * @type {Array}
     */
    var OPTION_KEYS = [
        'executeEventAction',
        'parse',
        'checkTarget',
        'getTarget',
        'attr'
    ];
    /**
     * MIP does not support external JavaScript, so we provide EventAction to trigger events between elements.
     * TODO: refactor
     * @class
     * @param {?Object} opt Options
     */
    function EventAction(opt) {
        opt && fn.extend(this, fn.pick(opt, OPTION_KEYS));
    }
    EventAction.prototype = {
        /**
         * Attribute name to trigger events.
         * @type {string}
         */
        attr: 'on',
        /**
         * Execute the event-action.
         * @param {string} type The event's type
         * @param {HTMLElement} target The source element of native event.
         * @param {Event} nativeEvent The native event.
         */
        execute: function (type, target, nativeEvent) {
            if (!target) {
                return;
            }
            var attr, parent;
            var attrSelector = '[' + this.attr + ']';
            do {
                if (attr = target.getAttribute(this.attr)) {
                    this._execute(this.parse(attr, type, nativeEvent));
                    target = target.parentElement;
                    if (!target) {
                        return;
                    }
                }
                target = dom.closest(target, attrSelector);
            } while (target);
        },
        /**
         * Ensure the target element is a MIPElement
         * @param {HTMLElement} target 
         * @return {boolean}
         */
        checkTarget: function (target) {
            return target && target.tagName && CHECK_REG.test(target.tagName.toLowerCase());
        },
        /**
         * Get the target element by ID
         * @param {string} id
         * @return {HTMLElement}
         */
        getTarget: function (id) {
            return document.getElementById(id);
        },
        /**
         * Excute the 'executeEventAction' of a MIPElement.
         * @param {Object} action
         * @param {MIPElement} target
         */
        executeEventAction: function (action, target) {
            target.executeEventAction && target.executeEventAction(action);
        },
        /**
         * Excute the parsed actions.
         * @private
         * @param {Array.<Object>} actions
         */
        _execute: function (actions) {
            for (var i = 0; i < actions.length; i++) {
                var action = actions[i];
                var target = this.getTarget(action.id);
                if (this.checkTarget(target)) {
                    this.executeEventAction(action, target);
                }
            }
        },
        /**
         * Parse the action string.
         * @param {string} actionString
         * @retrun {Array.<Object>}
         */
        parse: function (actionString, type, nativeEvent) {
            if (typeof actionString !== 'string') {
                return [];
            }
            var actions = actionString.trim().split(' ');
            var result = [];
            for (var i = 0; i < actions.length; i++) {
                var matchedResult = actions[i].match(PARSE_REG);
                if (matchedResult && matchedResult[1] === type) {
                    result.push({
                        type: matchedResult[1],
                        id: matchedResult[2],
                        handler: matchedResult[3],
                        arg: matchedResult[4],
                        event: nativeEvent
                    });
                }
            }
            return result;
        }
    };
    return EventAction;
});

// ======================
// src/dom/css-loader.js
// ======================


define('dom/css-loader', [], function () {
    /**
     * Creates the properly configured style element.
     * @param {Document} doc
     * @param {Element|ShadowRoot} cssRoot
     * @param {string} cssText
     * @param {boolean} isRuntimeCss
     * @param {string} name
     * @return {Element}
    */
    function insertStyleElement(doc, cssRoot, cssText, name, isRuntimeCss) {
        var style = doc.createElement('style');
        style.textContent = cssText;
        var afterElement = null;
        if (isRuntimeCss) {
            style.setAttribute('mip-main', '');
        } else {
            style.setAttribute('mip-extension', name || '');
            afterElement = cssRoot.querySelector('style[mip-main]');
        }
        insertAfterOrAtStart(cssRoot, style, afterElement);
        return style;
    }
    /**
     * Insert the styleElement in the root element after a element or at the start.
     */
    function insertAfterOrAtStart(styleRoot, styleElement, afterElement) {
        if (afterElement) {
            if (afterElement.nextSibling) {
                styleRoot.insertBefore(styleElement, afterElement.nextSibling);
            } else {
                styleRoot.appendChild(styleElement);
            }
        } else {
            // Add to the styleRoot element as first child
            styleRoot.insertBefore(styleElement, styleRoot.firstChild);
        }
    }
    return { insertStyleElement: insertStyleElement };
});

// ======================
// src/sleepWakeModule.js
// ======================


define('sleepWakeModule', ['require'], function (require) {
    'use strict';
    /**
     * The mip viewer.Complement native viewer, and solve the page-level problems.
     */
    function SleepWakeModule() {
        this._domObj = {};
        this._isAlreadyWake = {};
    }
    /**
     * The initialise method of sleepWakeModule
     */
    SleepWakeModule.prototype.init = function () {
        var confCon = '';
        try {
            var moduleConf = document.querySelector('#mip-sleep-wake-module');
            confCon = JSON.parse(moduleConf.textContent);
        } catch (e) {
            return;
        }
        if (!confCon) {
            return;
        }
        this._initConf('||', confCon);
        // init
        for (var key in confCon) {
            this._stateChange(key, true);
        }
    };
    /**
     * init page conf.
     * @param {string} split
     * @param {Object} confContent
     */
    SleepWakeModule.prototype._initConf = function (split, confContent) {
        // default value
        split = split || '||';
        for (var key in confContent) {
            var val = confContent[key];
            var valList = val.split(split);
            var len = valList.length;
            this._domObj[key] = [];
            for (var i = 0; i < len; i++) {
                try {
                    var idx = i;
                    var sleepDom = document.querySelector(valList[i]);
                    var domInfo = {
                        par: sleepDom.parentNode,
                        cln: 'mip-sleep-wake-textarea-' + key + '-' + idx
                    };
                    sleepDom.setAttribute('data-cln', domInfo.cln);
                    this._domObj[key].push(domInfo);
                } catch (e) {
                    continue;
                }
            }
        }
    };
    /**
     * wake the doms which are sleeped in conf by key
     * @param {string} key
     */
    SleepWakeModule.prototype.wake = function (key) {
        this._stateChange(key);
        this._close(key);
    };
    /**
     * reset the stutas of doms by the key
     * @param {string} key
     */
    SleepWakeModule.prototype.reset = function (key) {
        this._isAlreadyWake[key] = 0;
    };
    /**
     * close the operation of doms by the key
     * @param {string} key
     */
    SleepWakeModule.prototype._close = function (key) {
        this._isAlreadyWake[key] = 1;
    };
    /**
     * change the status of doms by paras[key, isSleep]
     * @param {string} key
     * @param {Boolean} isSleep
     */
    SleepWakeModule.prototype._stateChange = function (key, isSleep) {
        if (!key) {
            return;
        }
        var domList = this._domObj[key];
        if (!domList) {
            return;
        }
        var len = domList.length;
        if (len < 1) {
            return;
        }
        for (var i = 0; i < len; i++) {
            var sleepDom = domList[i];
            if (isSleep && !this._isAlreadyWake[key]) {
                var self = sleepDom.par && sleepDom.cln ? sleepDom.par.querySelector('[data-cln=' + sleepDom.cln + ']') : null;
                var parent = sleepDom.par;
                var tmpTextArea = document.createElement('textarea');
                var idx = i;
                if (self && self.tagName.toLowerCase() === 'textarea') {
                    continue;
                }
                if (!self) {
                    continue;
                }
                tmpTextArea.textContent = self.outerHTML;
                tmpTextArea.style.display = 'none';
                tmpTextArea.setAttribute('data-cln', sleepDom.cln);
                self.outerHTML = tmpTextArea.outerHTML;
            }
            if (!isSleep && !this._isAlreadyWake[key]) {
                var par = sleepDom.par;
                if (par) {
                    var tmpdom = par.querySelector('[data-cln=' + sleepDom.cln + ']');
                    if (tmpdom && tmpdom.tagName.toLowerCase() === 'textarea') {
                        tmpdom.outerHTML = tmpdom.textContent;
                    }
                }
            }
        }
    };
    return new SleepWakeModule();
});

// ======================
// src/layout.js
// ======================


define('layout', [], function () {
    'use strict';
    /**
     * Layout types.
     * @inner
     * @const
     * @type {Object}
     */
    var LAYOUT = {
        NODISPLAY: 'nodisplay',
        FIXED: 'fixed',
        FIXED_HEIGHT: 'fixed-height',
        RESPONSIVE: 'responsive',
        CONTAINER: 'container',
        FILL: 'fill',
        FLEX_ITEM: 'flex-item'
    };
    /**
     * Natural dimensions.
     * @inner
     * @const
     * @type {Object}
     */
    var NATURAL_DIMENSIONS = {
        'mip-pix': {
            width: '1px',
            height: '1px'
        },
        'mip-stats': {
            width: '1px',
            height: '1px'
        },
        'mip-audio': null
    };
    /**
     * Loading elements.
     * @inner
     * @const
     * @type {Object}
     */
    var LOADING_ELEMENTS = {
        'mip-anim': true,
        'mip-brightcove': true,
        'mip-embed': true,
        'mip-iframe': true,
        'mip-img': true,
        'mip-list': true,
        'mip-video': true
    };
    /**
     * Layout for MIPElement.
     * @class
     */
    function Layout() {
    }
    /**
     * @param {string} s
     * @return {Layout|undefined} Returns undefined in case of failure to parse
     *   the layout string.
     */
    Layout.prototype.parseLayout = function (s) {
        for (var i in LAYOUT) {
            if (LAYOUT[i] == s) {
                return s;
            }
        }
        return undefined;
    };
    /**
     * @param {Layout} layout
     * @return {string}
     */
    Layout.prototype.getLayoutClass = function (layout) {
        return 'mip-layout-' + layout;
    };
    /**
     * Whether an element with this layout inherently defines the size.
     * @param {Layout} layout
     * @return {boolean}
     */
    Layout.prototype.isLayoutSizeDefined = function (layout) {
        return layout == LAYOUT.FIXED || layout == LAYOUT.FIXED_HEIGHT || layout == LAYOUT.RESPONSIVE || layout == LAYOUT.FILL || layout == LAYOUT.FLEX_ITEM;
    };
    /**
     * Parses the CSS length value. If no units specified, the assumed value is
     * "px". Returns undefined in case of parsing error.
     * @param {string|undefined} s
     * @return {!LengthDef|undefined}
     */
    Layout.prototype.parseLength = function (s) {
        if (typeof s == 'number') {
            return s + 'px';
        }
        if (!s) {
            return undefined;
        }
        if (!/^\d+(\.\d+)?(px|em|rem|vh|vw|vmin|vmax|cm|mm|q|in|pc|pt)?$/.test(s)) {
            return undefined;
        }
        if (/^\d+(\.\d+)?$/.test(s)) {
            return s + 'px';
        }
        return s;
    };
    /**
     * Returns the numeric value of a CSS length value.
     * @param {string} length
     * @return {number}
     */
    Layout.prototype.getLengthNumeral = function (length) {
        return parseFloat(length);
    };
    /**
     * Determines whether the tagName is a known element that has natural dimensions
     * in our runtime or the browser.
     * @param {string} tagName The element tag name.
     * @return {DimensionsDef}
     */
    Layout.prototype.hasNaturalDimensions = function (tagName) {
        tagName = tagName.toLowerCase();
        return NATURAL_DIMENSIONS[tagName] !== undefined;
    };
    /**
     * Determines the default dimensions for an element which could vary across
     * different browser implementations, like <audio> for instance.
     * This operation can only be completed for an element whitelisted by
     * `hasNaturalDimensions`.
     * @param {!Element} element
     * @return {DimensionsDef}
     */
    Layout.prototype.getNaturalDimensions = function (element) {
        var tagName = element.tagName.toLowerCase();
        if (!NATURAL_DIMENSIONS[tagName]) {
            var doc = element.ownerDocument;
            var naturalTagName = tagName.replace(/^mip\-/, '');
            var temp = doc.createElement(naturalTagName);
            // For audio, should no-op elsewhere.
            temp.controls = true;
            temp.style.position = 'absolute';
            temp.style.visibility = 'hidden';
            doc.body.appendChild(temp);
            NATURAL_DIMENSIONS[tagName] = {
                width: (temp.offsetWidth || 1) + 'px',
                height: (temp.offsetHeight || 1) + 'px'
            };
            doc.body.removeChild(temp);
        }
        return NATURAL_DIMENSIONS[tagName];
    };
    /**
     * Whether the loading can be shown for the specified elemeent. This set has
     * to be externalized since the element's implementation may not be
     * downloaded yet.
     * @param {string} tagName The element tag name.
     * @return {boolean}
     */
    Layout.prototype.isLoadingAllowed = function (tagName) {
        return LOADING_ELEMENTS[tagName.toLowerCase()] || false;
    };
    /**
     * Apply layout for a MIPElement.
     * @param {MIPElement} element
     * @return {string}
     */
    Layout.prototype.applyLayout = function (element) {
        if (element._layoutInited) {
            return;
        }
        element._layoutInited = true;
        var layoutAttr = element.getAttribute('layout');
        var widthAttr = element.getAttribute('width');
        var heightAttr = element.getAttribute('height');
        var sizesAttr = element.getAttribute('sizes');
        var heightsAttr = element.getAttribute('heights');
        // Input layout attributes.
        var inputLayout = layoutAttr ? this.parseLayout(layoutAttr) : null;
        var inputWidth = widthAttr && widthAttr != 'auto' ? this.parseLength(widthAttr) : widthAttr;
        var inputHeight = heightAttr ? this.parseLength(heightAttr) : null;
        // Effective layout attributes. These are effectively constants.
        var width;
        var height;
        var layout;
        // Calculate effective width and height.
        if ((!inputLayout || inputLayout == LAYOUT.FIXED || inputLayout == LAYOUT.FIXED_HEIGHT) && (!inputWidth || !inputHeight) && this.hasNaturalDimensions(element.tagName)) {
            // Default width and height: handle elements that do not specify a
            // width/height and are defined to have natural browser dimensions.
            var dimensions = this.getNaturalDimensions(element);
            width = inputWidth || inputLayout == LAYOUT.FIXED_HEIGHT ? inputWidth : dimensions.width;
            height = inputHeight || dimensions.height;
        } else {
            width = inputWidth;
            height = inputHeight;
        }
        // Calculate effective layout.
        if (inputLayout) {
            layout = inputLayout;
        } else if (!width && !height) {
            layout = LAYOUT.CONTAINER;
        } else if (height && (!width || width == 'auto')) {
            layout = LAYOUT.FIXED_HEIGHT;
        } else if (height && width && (sizesAttr || heightsAttr)) {
            layout = LAYOUT.RESPONSIVE;
        } else {
            layout = LAYOUT.FIXED;
        }
        // Apply UI.
        element.classList.add(this.getLayoutClass(layout));
        if (this.isLayoutSizeDefined(layout)) {
            element.classList.add('mip-layout-size-defined');
        }
        if (layout == LAYOUT.NODISPLAY) {
            element.style.display = 'none';
        } else if (layout == LAYOUT.FIXED) {
            element.style.width = width;
            element.style.height = height;
        } else if (layout == LAYOUT.FIXED_HEIGHT) {
            element.style.height = height;
        } else if (layout == LAYOUT.RESPONSIVE) {
            var space = element.ownerDocument.createElement('mip-i-space');
            space.style.display = 'block';
            space.style.paddingTop = this.getLengthNumeral(height) / this.getLengthNumeral(width) * 100 + '%';
            element.insertBefore(space, element.firstChild);
            element._spaceElement = space;
        } else if (layout == LAYOUT.FILL) {
        } else if (layout == LAYOUT.CONTAINER) {
        } else if (layout == LAYOUT.FLEX_ITEM) {
            // Set height and width to a flex item if they exist.
            // The size set to a flex item could be overridden by `display: flex` later.
            if (width) {
                element.style.width = width;
            }
            if (height) {
                element.style.height = height;
            }
        }
        if (element.classList.contains('mip-hidden')) {
            element.classList.remove('mip-hidden');
        }
        return layout;
    };
    return new Layout();
});

// ======================
// src/fixed-element.js
// ======================


/**
 *
 * @file fixed element
 * @author xx
 * @modify wupeng10@baidu.com 2017-03-27 upgrade mip fixed, The only limitation is ten fixed elements.
 */
define('fixed-element', [
    'require',
    'util',
    'layout'
], function (require) {
    'use strict';
    var util = require('util');
    var layout = require('layout');
    var platform = util.platform;
    var css = util.css;
    /**
     * The fixed element processor.
     *
     * @class
     */
    function FixedElement() {
        /**
         * @private
         * @type {HTMLElement}
         */
        this._fixedLayer = null;
        /**
         * @private
         * @type {number}
         */
        this._maxFixedCount = 10;
        /**
         * @private
         * @type {number}
         */
        this._currentFixedCount = 0;
        /**
         * @private
         * @type {number}
         */
        this._count = 0;
        /**
         * Whether the platform is android and uc browser.
         * @private
         * @type {boolean}
         */
        this._isAndroidUc = platform.isUc() && !platform.isIos();
        /**
         * @private
         * @type {Array.<FixedElement>}
         */
        this._fixedElements = [];
    }
    /**
     * Initializition of current fixed element processor.
     */
    FixedElement.prototype.init = function () {
        var mipFixedElements = document.querySelectorAll('mip-fixed, mip-semi-fixed');
        this.setFixedElement(mipFixedElements);
        var fixedLen = this._fixedElements.length;
        var hasParentPage = window.parent !== window;
        if (platform.isIos() && hasParentPage) {
            var fixedLayer = this.getFixedLayer();
            for (var i = 0; i < fixedLen; i++) {
                var fixedElem = this._fixedElements[i];
                // clone mip-semi-fixed node
                if (fixedElem.element.tagName.toLowerCase() === 'mip-semi-fixed') {
                    var ele = fixedElem.element;
                    var parentNode = ele.parentNode;
                    var nextSbiling = ele.nextElementSibling;
                    var node = ele.cloneNode(true);
                    if (nextSbiling) {
                        parentNode.insertBefore(node, nextSbiling);
                    } else {
                        parentNode.appendChild(node);
                    }
                }
                this.moveToFixedLayer(fixedElem, i);
            }
        }
        if (hasParentPage) {
            this.doCustomElements();
        }
    };
    /**
     * Process some fixed elements.
     *
     * @param {Array.<MIPElement>} fixedElements fixed elements
     * @param {boolean}            move          flag for if moving to fixedlayer
     */
    FixedElement.prototype.setFixedElement = function (fixedElements, move) {
        var fixedEle = {};
        var fixedTypeCount = {};
        for (var i = 0; i < fixedElements.length; i++) {
            var ele = fixedElements[i];
            var fType = ele.getAttribute('type');
            // check invalid element and delete from document
            var bottom = layout.parseLength(ele.getAttribute('bottom'));
            var top = layout.parseLength(ele.getAttribute('top'));
            if (fType === 'left' && !top && !bottom || this._currentFixedCount >= this._maxFixedCount || fType === 'gototop' && ele.firstElementChild.tagName.toLowerCase() !== 'mip-gototop' || ele.tagName.toLowerCase() !== 'mip-semi-fixed' && ele.tagName.toLowerCase() !== 'mip-fixed') {
                ele.parentElement.removeChild(ele);
                continue;
            }
            // mip-semi-fixed
            if (ele.tagName.toLowerCase() === 'mip-semi-fixed') {
                if (!ele.id) {
                    ele.id = 'mip-semi-fixed' + this._count;
                }
                fType = 'semi-fixed';
            }
            // Calculate z-index based on the declared z-index and DOM position.
            css(ele, { 'z-index': 10000 - this._count });
            // While platform is android-uc, change the position to 'absolute'.
            if (this._isAndroidUc) {
                css(ele, { position: 'absolute' });
            }
            this._currentFixedCount++;
            this.setFixedElementRule(ele, fType);
            var eleId = 'Fixed' + this._count;
            fixedEle = {
                id: eleId,
                element: ele
            };
            fixedEle.element.setAttribute('mipdata-fixedIdx', eleId);
            // when `setFixedElement function` called by components,
            // the element will moved to fixedlayer directly.
            if (move) {
                this.moveToFixedLayer(fixedEle, this._count);
                return 10000 - this._count++;
            }
            this._count++;
            this._fixedElements.push(fixedEle);
        }
    };
    /**
     * Create the fixed layer of current object if it does not exsit and return it.
     *
     * @return {Element}
     */
    FixedElement.prototype.getFixedLayer = function () {
        if (this._fixedLayer) {
            return this._fixedLayer;
        }
        this._fixedLayer = document.createElement('body');
        this._fixedLayer.className = 'mip-fixedlayer';
        var height = this._isAndroidUc ? '100%' : 0;
        var width = this._isAndroidUc ? '100%' : 0;
        css(this._fixedLayer, {
            'position': 'absolute',
            'top': 0,
            'left': 0,
            'height': height,
            'width': width,
            'pointer-events': 'none',
            'overflow': 'hidden',
            'animation': 'none',
            '-webkit-animation': 'none',
            'border': 'none',
            'box-sizing': 'border-box',
            'box-shadow': 'none',
            'display': 'block',
            'float': 'none',
            'margin': 0,
            'opacity': 1,
            'outline': 'none',
            'transform': 'none',
            'transition': 'none',
            'visibility': 'visible',
            'background': 'none'
        });
        var html = document.getElementsByTagName('html')[0];
        html.appendChild(this._fixedLayer);
        return this._fixedLayer;
    };
    /**
     * Move a fixed element to the fixed layer.
     *
     * @param {MIPElement} fixedEle fixedEle
     * @param {string} idx idx
     */
    FixedElement.prototype.moveToFixedLayer = function (fixedEle, idx) {
        var element = fixedEle.element;
        if (element.parentElement === this._fixedLayer) {
            return;
        }
        if (!fixedEle.placeholder) {
            css(element, { 'pointer-events': 'initial' });
            fixedEle.placeholder = document.createElement('mip-i-ph');
            fixedEle.placeholder.setAttribute('mipdata-fixedIdx', fixedEle.id);
            fixedEle.placeholder.style.display = 'none';
        }
        element.parentElement.replaceChild(fixedEle.placeholder, element);
        this.getFixedLayer().appendChild(element);
    };
    /**
     * Process custom elements created by user.
     */
    FixedElement.prototype.doCustomElements = function () {
        var stylesheets = document.styleSheets;
        if (!stylesheets) {
            return;
        }
        // Find the 'position: fixed' elements.
        var fixedSelectors = [];
        for (var i = 0; i < stylesheets.length; i++) {
            var stylesheet = stylesheets[i];
            if (stylesheet.disabled || !stylesheet.ownerNode || stylesheet.ownerNode.tagName !== 'STYLE' || stylesheet.ownerNode.hasAttribute('mip-extension')) {
                continue;
            }
            this._findFixedSelectors(stylesheet.cssRules);
        }
    };
    /**
     * Find the selectors of 'position: fixed' elements.
     * CSSRule: https://developer.mozilla.org/en-US/docs/Web/API/CSSRule#Type_constants
     */
    FixedElement.prototype._findFixedSelectors = function (cssRules) {
        for (var i = 0; i < cssRules.length; i++) {
            var cssRule = cssRules[i];
            var rType = cssRule.type;
            if (rType === 1) {
                // CSSStyleRule
                if (cssRule.selectorText !== '*' && cssRule.style.position === 'fixed') {
                    try {
                        var fixedSelector = cssRule.selectorText;
                        var elements = document.querySelectorAll(fixedSelector);
                        for (var j = 0; j < elements.length; j++) {
                            // remove ?
                            elements[j].parentElement.removeChild(elements[j]);
                        }
                    } catch (e) {
                        console.warn('Cannot find the selector of custom fixed elements');
                    }
                }
            } else if (rType === 4) {
                // CSSMediaRule
                this._findFixedSelectors(cssRule.cssRules);
            } else if (rType === 12) {
                // CSSSupportsRule
                this._findFixedSelectors(cssRule.cssRules);
            }
        }
    };
    /**
     * Set styles of a fixed element with type.
     *
     * @param {MIPElement} fixedEle fixedEle
     * @param {string} type Layout type of the fixedEle.
     */
    FixedElement.prototype.setFixedElementRule = function (fixedEle, type) {
        switch (type) {
        case 'top':
            break;
        case 'bottom':
            break;
        case 'right':
            this.setStyle(fixedEle);
            break;
        case 'left':
            this.setStyle(fixedEle);
            break;
        case 'semi-fixed':
            break;
        case 'gototop':
            fixedEle.style.bottom = '90px';
            fixedEle.style.right = '10%';
            break;
        default:
            fixedEle.style.display = 'none';
        }
    };
    /**
     * Set styles of a fixed element.
     *
     * @param {MIPElement} fixedEle fixedEle
     */
    FixedElement.prototype.setStyle = function (fixedEle) {
        var bottom = layout.parseLength(fixedEle.getAttribute('bottom'));
        if (bottom) {
            fixedEle.style.bottom = bottom;
            return;
        }
        var top = layout.parseLength(fixedEle.getAttribute('top'));
        if (top) {
            fixedEle.style.top = top;
            return;
        }
    };
    /**
     * Show fixed layer
     *
     * @param {HTMLElement} layer layer
     */
    FixedElement.prototype.showFixedLayer = function (layer) {
        if (layer) {
            css(layer, { display: 'block' });
        }
    };
    /**
     * Hide fixed layer
     *
     * @param {HTMLElement} layer layer
     */
    FixedElement.prototype.hideFixedLayer = function (layer) {
        if (layer) {
            css(layer, { display: 'none' });
        }
    };
    /**
     * set a placeholder
     *
     * @param {Object} height the height of element
     */
    FixedElement.prototype.setPlaceholder = function (height) {
        var placeholder = document.body.querySelector('div[mip-fixed-placeholder]');
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.setAttribute('mip-fixed-placeholder', '');
            util.css(placeholder, {
                position: 'relative',
                display: 'none'
            });
            document.body.appendChild(placeholder);
        }
        if (height) {
            util.css(placeholder, {
                display: 'block',
                height: height + 'px'
            });
        }
    };
    return new FixedElement();
});

// ======================
// src/viewport.js
// ======================


define('viewport', [
    'require',
    './util',
    './utils/event-emitter',
    './fixed-element'
], function (require) {
    'use strict';
    var util = require('./util');
    var EventEmitter = require('./utils/event-emitter');
    var fixedElement = require('./fixed-element');
    var rect = util.rect;
    // Native objects.
    var docElem = document.documentElement;
    var win = window;
    /**
     * The object is to solve a series of problems when the page in an iframe and
     * provide some additional methods.
     */
    var viewport = {
        /**
         * Get the current vertical position of the page
         * @return {number}
         */
        getScrollTop: function () {
            return rect.getScrollTop();
        },
        /**
         * Get the current horizontal position of the page
         * @return {number}
         */
        getScrollLeft: function () {
            return rect.getScrollLeft();
        },
        /**
         * Set the current vertical position of the page
         * @param {number} top The target scrollTop
         */
        setScrollTop: function (top) {
            rect.setScrollTop(top);
        },
        /**
         * Get the width of the viewport
         * @return {number}
         */
        getWidth: function () {
            return win.innerWidth || docElem.clientWidth;
        },
        /**
         * Get the height of the viewport
         * @return {number}
         */
        getHeight: function () {
            return win.innerHeight || docElem.clientHeight;
        },
        /**
         * Get the scroll width of the page
         * @return {number}
         */
        getScrollWidth: function () {
            return rect.getScrollWidth();
        },
        /**
         * Get the scroll height of the page
         * @return {number}
         */
        getScrollHeight: function () {
            return rect.getScrollHeight();
        },
        /**
         * Get the rect of the viewport.
         * @return {Object}
         */
        getRect: function () {
            return rect.get(this.getScrollLeft(), this.getScrollTop(), this.getWidth(), this.getHeight());
        }
    };
    /**
     * The bound handler for changed event.
     * @inner
     * @type {Function}
     */
    var boundChangeEvent;
    /**
     * Initialize the viewport
     * @return {Viewport}
     */
    function init() {
        fixedElement.init();
        boundChangeEvent = changedEvent.bind(this);
        (util.platform.needSpecialScroll ? document.body : win).addEventListener('scroll', scrollEvent.bind(this), false);
        win.addEventListener('resize', resizeEvent.bind(this), false);
        return this;
    }
    /**
     * Whether the changed event is firing.
     * @inner
     * @type {boolean}
     */
    var isChanging = false;
    /**
     * The last event object of changed event.
     * @inner
     * @type {Event}
     */
    var lastEvent = null;
    /**
     * The last time of changed event.
     * @inner
     * @type {number}
     */
    var lastTime;
    /**
     * The last scrollTop of changed event.
     * @inner
     * @type {number}
     */
    var lastScrollTop;
    /**
     * The scroll handler
     * @param {Event} event
     */
    function scrollEvent(event) {
        var scrollTop = this.getScrollTop();
        var now = Date.now();
        // If the delta time >= 20ms, immediately calculate whether to trigger changed.
        // PS: UC browser does not dispatch the scroll event, when the finger is pressed.
        if (!isChanging || now - lastTime >= 20) {
            isChanging = true;
            boundChangeEvent();
            lastTime = now;
            lastScrollTop = scrollTop;
            lastEvent = event;
        }
        this.trigger('scroll', event);
    }
    /**
     * The resize event handler.
     * @param {Event} event
     */
    function resizeEvent(event) {
        this.trigger('resize', event);
    }
    /**
     * Timer for changed event.
     * @inner
     * @type {number}
     */
    var changedTimer = null;
    /**
     * To determine whether to trigger a changed event.
     */
    function changedEvent() {
        var now = Date.now();
        var delay = now - lastTime || 0;
        clearTimeout(changedTimer);
        if (delay && Math.abs((lastScrollTop - this.getScrollTop()) / delay) < 0.03) {
            isChanging = false;
            this.trigger('changed', lastEvent, this.getRect());
        } else {
            changedTimer = setTimeout(boundChangeEvent, delay >= 20 ? 20 : 20 - delay);
        }
    }
    // Mix the methods and attributes of Event into the viewport.
    EventEmitter.mixin(viewport);
    return init.call(viewport);
});

// ======================
// src/customElement.js
// ======================


define('customElement', [
    'require',
    './utils/event-emitter'
], function (require) {
    'use strict';
    var EventEmitter = require('./utils/event-emitter');
    /**
     * The constructor of  base class of custom element
     * @param {MIPElement} element
     * @class
     */
    function customElement(element) {
        /**
         * @type {MIPElement}
         * @public
         */
        this.element = element;
        if (this.init) {
            this.init();
        }
    }
    /**
     * Apply the fill content style to an element
     * @param {HTMLElement} ele
     * @param {boolean} isReplaced
     */
    customElement.prototype.applyFillContent = function (ele, isReplaced) {
        ele.classList.add('mip-fill-content');
        if (isReplaced) {
            ele.classList.add('mip-replaced-content');
        }
    };
    /**
     * Called when the MIPElement is created.
     */
    customElement.prototype.createdCallback = function () {
    };
    /**
     * Called when the MIPElement is inserted into the DOM.
     */
    customElement.prototype.attachedCallback = function () {
    };
    /**
     * Called when the MIPElement is removed from the DOM.
     */
    customElement.prototype.detachedCallback = function () {
    };
    /**
     * Called when the MIPElement's attribute is changed.
     */
    customElement.prototype.attributeChangedCallback = function () {
    };
    /**
     * Called when the MIPElement first enters the viewport.
     */
    customElement.prototype.firstInviewCallback = function () {
    };
    /**
     * Called when the MIPElement has entered or exited the viewport.
     */
    customElement.prototype.viewportCallback = function () {
    };
    /**
     * Control whether the MIPElement is rendred ahead.
     * @return {Boolean} If the result is TRUE, the element will be rendred ahead.
     */
    customElement.prototype.prerenderAllowed = function () {
        return false;
    };
    /**
     * Return the current component containing resources.
     * If it returns true, complete should be called.
     * @return {Boolean}
     */
    customElement.prototype.hasResources = function () {
        return false;
    };
    /**
     * Called when the MIPElement is first inserted into the document.
     */
    customElement.prototype.build = function () {
    };
    /**
     * Expend current element's attributes which selected by attrs to an other object.
     * @param {Array.<string>} attrs Attributes' name list
     * @param {Object} element The target element
     * @return {Object} 
     */
    customElement.prototype.expendAttr = function (attrs, element) {
        for (var i = 0; i < attrs.length; i++) {
            var attr = attrs[i];
            if (this.element.hasAttribute(attr)) {
                var val = this.element.getAttribute(attr);
                element.setAttribute ? element.setAttribute(attr, val) : element[attr] = val;
            }
        }
        return element;
    };
    /**
     * Add event actions such as `this.addEventAction("default open", handler)`
     * @param {string} name
     * @param {Function} handler
     */
    customElement.prototype.addEventAction = function () {
        var evt = this._actionEvent;
        if (!evt) {
            evt = this._actionEvent = new EventEmitter();
            evt.setEventContext(this);
        }
        evt.on.apply(evt, arguments);
    };
    /**
     * Trigger the handlers had been added by `addEventAction` of an action
     * @param {string} action The action's name
     */
    customElement.prototype.executeEventAction = function (action) {
        var eventObj = this._actionEvent;
        if (action && eventObj) {
            eventObj.trigger(action.handler, action.event, action.arg);
        }
    };
    /**
     * Notice that resources are loaded.
     */
    customElement.prototype.resourcesComplete = function () {
        this.element.resourcesComplete();
    };
    return {
        /**
         * Create a class of a new type mip element
         * @return {Function}
         */
        create: function () {
            function impl(element) {
                customElement.call(this, element);
            }
            ;
            impl.prototype = Object.create(customElement.prototype);
            return impl;
        }
    };
});

// ======================
// src/viewer.js
// ======================


define('viewer', [
    'require',
    './util',
    './viewport',
    './utils/event-action',
    './utils/event-emitter',
    './utils/fn'
], function (require) {
    'use strict';
    var util = require('./util');
    var viewport = require('./viewport');
    var Gesture = util.Gesture;
    var css = util.css;
    var platform = util.platform;
    var EventAction = require('./utils/event-action');
    var EventEmitter = require('./utils/event-emitter');
    var fn = require('./utils/fn');
    /**
     * Save window.
     * @inner
     * @type {Object}
     */
    var win = window;
    /**
     * The mip viewer.Complement native viewer, and solve the page-level problems.
     */
    var viewer = {
        /**
         * The initialise method of viewer
         */
        init: function () {
            /**
             * The gesture of document.Used by the event-action of Viewer.
             * @private
             * @type {Gesture}
             */
            this._gesture = new Gesture(document, { preventX: false });
            this.setupEventAction();
            // handle preregistered  extensions
            this.handlePreregisteredExtensions();
            if (this.isIframed) {
                this.patchForIframe();
                // proxy links
                this._proxyLink();
                this._viewportScroll();
                // Tell parent page the current page is loaded.
                this.sendMessage('mippageload', {
                    time: Date.now(),
                    title: encodeURIComponent(document.title)
                });
            }
        },
        /**
         * The iframed state.
         * @type {Boolean}
         * @public
         */
        isIframed: win !== top,
        /** 
         * Patch for iframe
         */
        patchForIframe: function () {
            // When page in an iframe and browser is IOS, page can not be scrollable. So we need
            // set the style to be `height: 100%; overflow: auto` for solving this problem.
            if (platform.needSpecialScroll) {
                css([
                    document.documentElement,
                    document.body
                ], {
                    'height': '100%',
                    'overflow-y': 'auto',
                    '-webkit-overflow-scrolling': 'touch'
                });
                css(document.body, 'position', 'relative');
            }
            // Fix iphone 5s UC and ios 9 safari bug. While the back button is clicked, the cached page has some problems.
            // So we are forced to load the page in iphone 5s UC and ios 9 safari.
            var iosVersion = platform.getOsVersion();
            iosVersion = iosVersion ? iosVersion.split('.')[0] : '';
            var needBackReload = iosVersion == '8' && platform.isUc() && screen.width === 320 || iosVersion == '9' && platform.isSafari();
            if (needBackReload) {
                window.addEventListener('pageshow', function (e) {
                    if (e.persisted) {
                        document.body.style.display = 'none';
                        location.reload();
                    }
                });
            }
        },
        /**
         * Show contents of page. The contents will not be displayed until the components are registered.
         */
        show: function () {
            css(document.body, {
                'opacity': 1,
                'animation': 'none'
            });
            this.isShow = true;
            this._showTiming = Date.now();
            this.trigger('show', this._showTiming);
        },
        /**
         * Send message to parent page.
         * @param {string} eventName
         * @param {Object} data Message body
         */
        sendMessage: function (eventName, data) {
            if (this.isIframed) {
                window.parent.postMessage({
                    event: eventName,
                    data: data
                }, '*');
            }
        },
        /**
         * Setup event-action of viewer. To handle `on="tap:xxx"`.
         */
        setupEventAction: function () {
            var hasTouch = fn.hasTouch();
            var eventAction = this.eventAction = new EventAction();
            if (hasTouch) {
                // In mobile phone, bind Gesture-tap which listen to touchstart/touchend event
                this._gesture.on('tap', function (event) {
                    eventAction.execute('tap', event.target, event);
                });
            } else {
                // In personal computer, bind click event, then trigger event. eg. `on=tap:sidebar.open`, when click, trigger open() function of #sidebar
                document.addEventListener('click', function (event) {
                    eventAction.execute('tap', event.target, event);
                }, false);
            }
        },
        /**
         * Setup event-action of viewer. To handle `on="tap:xxx"`.
         */
        handlePreregisteredExtensions: function () {
            window.MIP = window.MIP || {};
            window.MIP.push = function (extensions) {
                if (extensions && typeof extensions.func == 'function') {
                    extensions.func();
                }
            };
            var preregisteredExtensions = window.MIP.extensions;
            if (preregisteredExtensions && preregisteredExtensions.length) {
                for (var i = 0; i < preregisteredExtensions.length; i++) {
                    var curExtensionObj = preregisteredExtensions[i];
                    if (curExtensionObj && typeof curExtensionObj.func == 'function') {
                        curExtensionObj.func();
                    }
                }
            }
        },
        /**
         * Event binding callback.
         * For overridding _bindEventCallback of EventEmitter.
         *
         * @private
         * @param {string} name
         * @param {Function} handler
         */
        _bindEventCallback: function (name, handler) {
            if (name === 'show' && this.isShow && typeof handler === 'function') {
                handler.call(this, this._showTiming);
            }
        },
        /**
         * Listerning viewport scroll
         * @private
         */
        _viewportScroll: function () {
            var self = this;
            var dist = 0;
            var direct = 0;
            var scrollTop = viewport.getScrollTop();
            var lastDirect = 0;
            var scrollHeight = viewport.getScrollHeight();
            var lastScrollTop = 0;
            var wrapper = util.platform.needSpecialScroll ? document.body : win;
            wrapper.addEventListener('touchstart', function (event) {
                scrollTop = viewport.getScrollTop();
                scrollHeight = viewport.getScrollHeight();
            });
            function pagemove() {
                scrollTop = viewport.getScrollTop();
                scrollHeight = viewport.getScrollHeight();
                if (scrollTop > 0 && scrollTop < scrollHeight) {
                    if (lastScrollTop < scrollTop) {
                        // down
                        direct = 1;
                    } else if (lastScrollTop > scrollTop) {
                        // up
                        direct = -1;
                    }
                    dist = lastScrollTop - scrollTop;
                    lastScrollTop = scrollTop;
                    if (dist > 10 || dist < -10) {
                        // 转向判断，暂时没用到，后续升级需要
                        lastDirect = dist / Math.abs(dist);
                        self.sendMessage('mipscroll', {
                            'direct': direct,
                            'dist': dist
                        });
                    }
                }
            }
            wrapper.addEventListener('touchmove', function (event) {
                pagemove();
            });
            wrapper.addEventListener('touchend', function (event) {
                pagemove();
            });
        },
        /**
         * Agent all the links in iframe.
         * @private
         */
        _proxyLink: function () {
            var self = this;
            var regexp = /^http/;
            util.event.delegate(document, 'a', 'click', function (e) {
                if (!this.href) {
                    return;
                }
                // For mail、phone、market、app ...
                // Safari failed when iframed. So add the `target="_top"` to fix it.
                if (!regexp.test(this.href)) {
                    this.setAttribute('target', '_top');
                    return;
                }
                e.preventDefault();
                var messageKey = 'mibm-jumplink';
                var messageData = {};
                messageData.url = this.href;
                if (this.hasAttribute('mip-link')) {
                    var parent = this.parentNode;
                    messageKey = 'loadiframe';
                    messageData.title = parent.getAttribute('title') || parent.innerText.trim().split('\n')[0];
                    messageData.click = parent.getAttribute('data-click');
                } else if (this.getAttribute('data-type') === 'mip') {
                    messageKey = 'loadiframe';
                    messageData.title = this.getAttribute('data-title') || this.innerText.trim().split('\n')[0];
                    messageData.click = this.getAttribute('data-click');
                }
                self.sendMessage(messageKey, messageData);
            }, false);
        }
    };
    EventEmitter.mixin(viewer);
    return viewer;
});

// ======================
// src/performance.js
// ======================


define('performance', [
    'require',
    './util',
    './viewer'
], function (require) {
    'use strict';
    var util = require('./util');
    var EventEmitter = util.EventEmitter;
    var viewer = require('./viewer');
    /**
     * Store first-screen elements.
     * @inner
     */
    var fsElements = [];
    /**
     * Locked flag of fsElements.
     * @inner
     */
    var fsElementsLocked = false;
    /**
     * Start flag. This will be runned only once.
     * @inner
     */
    var isStart = false;
    /**
     * Record time.
     * @inner
     */
    var recorder = {};
    /**
     * Event for updating timing.
     * @inner
     */
    var performanceEvent = new EventEmitter();
    /**
     * Add first-screen element.
     * @param {HTMLElement} element
     */
    function addFsElement(element) {
        if (!fsElementsLocked) {
            fsElements.push(element);
        }
    }
    /**
     * Remove element from fsElements.
     * @param {HTMLElement} element
     */
    function removeFsElement(element) {
        var index = fsElements.indexOf(element);
        if (index != -1) {
            fsElements.splice(index, 1);
        }
    }
    /**
     * Get the timings.
     * @return {Object}
     */
    function getTiming() {
        var nativeTiming;
        var performance = window.performance;
        if (performance && performance.timing) {
            nativeTiming = performance.timing.toJSON ? performance.timing.toJSON() : util.fn.extend({}, performance.timing);
        } else {
            nativeTiming = {};
        }
        return util.fn.extend(nativeTiming, recorder);
    }
    /**
     * Record timing by name.
     * @param {string} name Name of the timing.
     * @param {?number} timing  
     */
    function recordTiming(name, timing) {
        recorder[name] = parseInt(timing, 10) || Date.now();
        performanceEvent.trigger('update', getTiming());
    }
    /**
     * Try recording first-screen loaded.
     */
    function tryRecordFirstScreen() {
        if (recorder.MIPFirstScreen) {
            return;
        }
        if (fsElements.length === 0) {
            recordTiming('MIPFirstScreen');
        }
    }
    /**
     * Record dom loaded timing.
     */
    function domLoaded() {
        recordTiming('MIPDomContentLoaded');
        setTimeout(function () {
            fsElements = fsElements.filter(function (ele) {
                return ele.inViewport();
            });
            // Lock the fsElements. No longer add fsElements.
            fsElementsLocked = true;
            tryRecordFirstScreen();
        }, 10);
    }
    /**
     * First-element loaded.
     * @param {HTMLElement} element
     */
    function fsElementLoaded(element) {
        removeFsElement(element);
        tryRecordFirstScreen();
    }
    /**
     * Start.
     * @param {number} startTiming The MIP start timing.
     */
    function start(startTiming) {
        if (isStart) {
            return;
        }
        isStart = true;
        recordTiming('MIPStart', startTiming);
        viewer.on('show', function (showTiming) {
            recordTiming('MIPPageShow', showTiming);
        });
        if (document.readyState === 'complete') {
            domLoaded();
        } else {
            document.addEventListener('DOMContentLoaded', domLoaded, false);
        }
    }
    return {
        start: start,
        addFsElement: addFsElement,
        fsElementLoaded: fsElementLoaded,
        getTiming: getTiming,
        on: function () {
            performanceEvent.on.apply(performanceEvent, arguments);
        }
    };
});

// ======================
// src/resources.js
// ======================


define('resources', [
    'require',
    './utils/fn',
    './viewport',
    './dom/rect',
    './utils/gesture'
], function (require) {
    'use strict';
    var fn = require('./utils/fn');
    var viewport = require('./viewport');
    var rect = require('./dom/rect');
    var Gesture = require('./utils/gesture');
    /**
     * Store the resources.
     * @inner
     * @type {Object}
     */
    var resources = {};
    /**
     * Resources counter.
     * @inner
     * @type {number}
     */
    var counter = 0;
    /**
     * MIP Elements's controller. It's use to manage all the elements's custom life circle and
     * provide the overall interfaces of the MIP Elements.
     * @class
     */
    function Resources() {
        /**
         * Resources id
         * @private
         * @type {number}
         */
        this._rid = counter++;
        /**
         * Element id
         * @private
         * @type {number}
         */
        this._eid = 0;
        // add to resources
        resources[this._rid] = {};
        // Reduce the frequency of updating viewport state
        var update = this._update.bind(this);
        /**
         * The method to udpate state.
         * @type {Function}
         */
        this.updateState = fn.throttle(update);
        /**
         * Viewport
         * @private
         * @type {Object}
         */
        this._viewport = viewport;
        this._gesture = new Gesture(document.body, { preventX: false });
        this._bindEvent();
    }
    Resources.prototype = {
        /**
         * Bind the events of current object.
         */
        _bindEvent: function () {
            var self = this;
            var timer;
            this._viewport.on('changed resize', this.updateState);
            this._gesture.on('swipe', function (e, data) {
                var delay = Math.round(data.velocity * 600);
                delay < 100 && (delay = 100);
                delay > 600 && (delay = 600);
                clearTimeout(timer);
                timer = setTimeout(self.updateState, delay);
            });
            this.updateState();
        },
        /**
         * Add an element for current object and update all the elements's state.
         * @param {MIPElement} element A mip element
         */
        add: function (element) {
            element._eid = this._eid++;
            resources[this._rid][element._eid] = element;
            element.build();
            this.updateState();
        },
        /**
         * Remove element from current resources object.
         * @param {MIPElement|string} element Mip element or _eid of element
         * @return {boolean} the removed state of element
         */
        remove: function (element) {
            var id = element._eid || element;
            if (Number.isFinite(+id) && resources[this._rid][id]) {
                delete resources[this._rid][id];
                return true;
            } else {
                return false;
            }
        },
        /**
         * Return an object of resources.
         * @return {Array}
         */
        getResources: function () {
            return resources[this._rid];
        },
        /**
         * Return an array of resources.
         */
        getResourcesList: function () {
            return fn.values(this.getResources());
        },
        /**
         * Set an element's viewport state to 'true' or 'false'.
         * @param {MIPElement} element
         * @param {boolean} inViewport
         */
        setInViewport: function (element, inViewport) {
            if (element.inViewport() !== inViewport) {
                element.viewportCallback(inViewport);
            }
        },
        /**
         * Update elements's viewport state.
         * @private
         */
        _update: function () {
            var resources = this.getResources();
            var viewportRect = this._viewport.getRect();
            for (var i in resources) {
                // Compute the viewport state of current element.
                // If current element`s prerenderAllowed returns `true` always set the state to be `true`.
                var inViewport = resources[i].prerenderAllowed() || rect.overlapping(rect.getElementRect(resources[i]), viewportRect);
                this.setInViewport(resources[i], inViewport);
            }
        }
    };
    /**
     * Forced set the element's viewport state to 'true'.
     * @param {MIPElement} element
     */
    Resources.prerenderElement = function (element) {
        if (element.inViewport && !element.inViewport()) {
            element.viewportCallback && element.viewportCallback(true);
        }
    };
    return Resources;
});

// ======================
// src/element.js
// ======================


define('element', [
    'require',
    './dom/css-loader',
    './layout',
    './performance',
    './resources'
], function (require) {
    'use strict';
    var cssLoader = require('./dom/css-loader');
    var layout = require('./layout');
    var performance = require('./performance');
    /**
     * Storage of custom elements.
     * @inner
     * @type {Object}
     */
    var customElements = {};
    /**
     * Save resources.
     * @inner
     * @type {Resources}
     */
    var resources;
    /**
     * Save the base element prototype to avoid duplicate initialization.
     * @inner
     * @type {Object}
     */
    var baseElementProto;
    /**
     * Create a basic prototype of mip elements classes
     * @return {Object}
     */
    function createBaseElementProto() {
        if (baseElementProto) {
            return baseElementProto;
        }
        // Base element inherits from HTMLElement
        var proto = Object.create(HTMLElement.prototype);
        /**
         * Created callback of MIPElement. It will initialize the element.
         */
        proto.createdCallback = function () {
            var CustomEle = customElements[this.name];
            this.classList.add('mip-element');
            /**
             * Viewport state
             * @private
             * @type {boolean}
             */
            this._inViewport = false;
            /**
             * Whether the element is into the viewport.
             * @private
             * @type {boolean}
             */
            this._firstInViewport = false;
            /**
             * The resources object.
             * @private
             * @type {Object}
             */
            this._resources = resources;
            /**
             * Instantiated the custom element.
             * @type {Object}
             * @public
             */
            var customElement = this.customElement = new CustomEle(this);
            customElement.createdCallback();
            // Add first-screen element to performance.
            if (customElement.hasResources()) {
                performance.addFsElement(this);
            }
        };
        /**
         * When the element is inserted into the DOM, initialize the layout and add the element to the '_resources'.
         */
        proto.attachedCallback = function () {
            // Apply layout for this.
            this._layout = layout.applyLayout(this);
            this.customElement.attachedCallback();
            // Add to resource manager.
            this._resources.add(this);
        };
        /**
         * When the element is removed from the DOM, remove it from '_resources'.
         */
        proto.detachedCallback = function () {
            this.customElement.detachedCallback();
            this._resources.remove(this);
            performance.fsElementLoaded(this);
        };
        /**
         * Call the attributeChanged of custom element.
         */
        proto.attributeChangedCallback = function () {
            this.customElement.attributeChangedCallback();
        };
        /**
         * Check whether the element is in the viewport.
         * @return {boolean}
         */
        proto.inViewport = function () {
            return this._inViewport;
        };
        /**
         * Called when the element enter or exit the viewport.
         * And it will call the firstInviewCallback and viewportCallback of the custom element.
         */
        proto.viewportCallback = function (inViewport) {
            this._inViewport = inViewport;
            if (!this._firstInViewport) {
                this._firstInViewport = true;
                this.customElement.firstInviewCallback();
            }
            this.customElement.viewportCallback(inViewport);
        };
        /**
         * Check whether the building callback has been executed.
         * @return {boolean}
         */
        proto.isBuilt = function () {
            return this._built;
        };
        /**
         * Check whether the element need to be rendered in advance.
         * @reutrn {boolean}
         */
        proto.prerenderAllowed = function () {
            return this.customElement.prerenderAllowed();
        };
        /**
         * Build the element and the custom element.
         * This will be executed only once.
         */
        proto.build = function () {
            if (this.isBuilt()) {
                return;
            }
            // Add `try ... catch` avoid the executing build list being interrupted by errors.
            try {
                this.customElement.build();
                this._built = true;
            } catch (e) {
                console.warn('build error:', e);
            }
        };
        /**
         * Method of executing event actions of the custom Element 
         */
        proto.executeEventAction = function (action) {
            this.customElement.executeEventAction(action);
        };
        /**
         * Called by customElement. And tell the performance that element is loaded.
         */
        proto.resourcesComplete = function () {
            performance.fsElementLoaded(this);
        };
        return baseElementProto = proto;
    }
    /**
     * Create a mip element prototype by name
     * @param {string} name The mip element's name
     * @return {Object}
     */
    function createMipElementProto(name) {
        var proto = Object.create(createBaseElementProto());
        proto.name = name;
        return proto;
    }
    /**
     * Add a style tag to head by csstext
     * @param {string} css Css code
     */
    function loadCss(css, name) {
        if (css) {
            cssLoader.insertStyleElement(document, document.head, css, name, false);
        }
    }
    /**
     * Register MIPElement. 
     * @param {string} name Name of a MIPElement.
     * @param {Class} elementClass
     * @param {string} css The csstext of the MIPElement.
     */
    function registerElement(name, elementClass, css) {
        if (customElements[name]) {
            return;
        }
        if (!resources) {
            var Resources = require('./resources');
            resources = new Resources();
        }
        customElements[name] = elementClass;
        loadCss(css, name);
        document.registerElement(name, { prototype: createMipElementProto(name) });
    }
    return registerElement;
});

// ======================
// src/templates.js
// ======================


define('templates', [], function () {
    'use strict';
    var CACHED_ATTR = '_mip_template_cached';
    function Template() {
    }
    Template.prototype = {
        cache: function () {
        },
        render: function () {
        }
    };
    function Templates() {
        this._templates = {};
        this._solverList = {};
    }
    Templates.prototype = {
        constructor: Templates,
        Template: Template,
        _create: function (type) {
            if (!this._templates[type]) {
                var solve;
                var templateProm = this._templates[type] = new Promise(function (s) {
                    solve = s;
                });
                this._solverList[type] = solve;
            }
            return this._templates[type];
        },
        _getTemplate: function (type) {
            return this._create(type);
        },
        register: function (type, Template) {
            this._create(type);
            var solve = this._solverList[type];
            solve(new Template());
        },
        isTemplateClass: function (obj) {
            if (!obj || !obj.prototype) {
                return false;
            }
            return Template.prototype.isPrototypeOf(obj.prototype);
        },
        render: function (element, data, obj) {
            var self = this;
            var template = self.find(element);
            if (!template) {
                return;
            }
            var type = template.getAttribute('type');
            var templateHTML = template.innerHTML;
            return self._getTemplate(type).then(function (impl) {
                if (!template[CACHED_ATTR]) {
                    template[CACHED_ATTR] = true;
                    impl.cache(templateHTML);
                }
                data = self.extendFun(data);
                // array
                if (Array.isArray(data)) {
                    if (data.length === 0) {
                        return Promise.resolve([]);
                    }
                    return data.map(function (item) {
                        return impl.render(templateHTML, item);
                    });
                }
                // cb
                if (obj) {
                    return {
                        element: element,
                        html: impl.render(templateHTML, data)
                    };
                }
                // html
                return impl.render(templateHTML, data);
            });
        },
        find: function (element) {
            if (!element || element.nodeType !== 1) {
                console.error('Template parent element must be a node element');
                return null;
            }
            var templateId = element.getAttribute('template');
            var template;
            if (templateId) {
                template = document.getElementById(templateId);
            } else {
                template = element.querySelector('template');
            }
            if (!template) {
                console.error('Can not find template element');
                return null;
            }
            return template;
        },
        extendFun: function (data) {
            try {
                data.escape2Html = function () {
                    return function (text, render) {
                        return render(text).replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#x2F;/gi, '/');
                    };
                };
                data.isSF = function () {
                    return this.urltype === 'sf';
                };
            } catch (e) {
            }
            return data;
        },
        inheritTemplate: function () {
            function inheritor() {
                Template.apply(this, arguments);
            }
            inheritor.prototype = Object.create(Template.prototype);
            inheritor.constructor = inheritor;
            return inheritor;
        }
    };
    return new Templates();
});

// ======================
// src/hash.js
// ======================


/**
 * @file Hash Function. Support hash get function
 * @author Jenny_L
 */
define('hash', ['require'], function (require) {
    'use strict';
    /**
     * Hash class
     *
     * @class
     */
    function Hash() {
        // init sessionStorage status
        this.ssEnabled = ssEnabled();
        this.pageId = window.location.href.split('#').shift();
        var hash = window.location.hash;
        if (this.ssEnabled) {
            var ssHash = window.sessionStorage.getItem(this.pageId) || '';
            // add the window.location.hash
            hash = ssHash + hash;
        }
        this.hashTree = this._getHashObj(hash);
        // if hash is exist, try storage the value into sessionStroage
        if (hash) {
            var curHash = this._getHashValue();
            if (this.ssEnabled) {
                window.sessionStorage.setItem(this.pageId, curHash);
            }
            window.location.hash = curHash;
        }
        /**
         * get hash value of specific key
         *
         * @param  {string} key key
         * @return {value}     [description]
         */
        this.get = function (key) {
            return this.hashTree[key] || '';
        };
    }
    /**
     * refresh hash object
     */
    Hash.prototype.refreshHashTree = function () {
        var originalHash = window.location.hash;
        this.hashTree = this._getHashObj(originalHash);
    };
    /**
     * get hash object from hash
     *
     * @param  {string} originalHash hash
     * @return {Object} object of each hash
     */
    Hash.prototype._getHashObj = function (originalHash) {
        var hashObj = {};
        if (originalHash) {
            var hashVal;
            var tmpList = originalHash.split('#');
            hashVal = tmpList.join('&');
            var hashArr = hashVal.split('&');
            var haLen = hashArr.length;
            for (var i = 0; i < haLen; i++) {
                var curOne = hashArr[i];
                var eqIdx = curOne.indexOf('=');
                var key;
                var val;
                if (eqIdx !== -1) {
                    key = decodeURIComponent(curOne.substring(0, eqIdx)).trim();
                    val = decodeURIComponent(curOne.substring(eqIdx + 1)).trim();
                } else {
                    key = decodeURIComponent(curOne).trim();
                    val = '';
                }
                if (key) {
                    // rewrite the Repeat Key
                    hashObj[key] = val;
                }
            }
        }
        return hashObj;
    };
    /**
     * get hash value from hash tree
     *
     * @return {string} hash
     */
    Hash.prototype._getHashValue = function () {
        var hashTree = this.hashTree;
        var hash = '';
        for (var key in hashTree) {
            var val = hashTree[key];
            hash += '&' + key + '=' + encodeURIComponent(val);
        }
        return hash.slice(1);
    };
    /**
     * test ss is available
     */
    function ssEnabled() {
        try {
            window.sessionStorage.setItem('_t', 1);
            window.sessionStorage.removeItem('_t');
            return true;
        } catch (e) {
            return false;
        }
    }
    return new Hash();
});

// ======================
// src/components/mip-img.js
// ======================


/**
 * @file mip-img 图片组件
 * @author wangpei07
 */
define('components/mip-img', [
    'require',
    'util',
    'customElement',
    'naboo',
    'viewport'
], function (require) {
    'use strict';
    var util = require('util');
    var customElem = require('customElement').create();
    var Gesture = util.Gesture;
    var css = util.css;
    var rect = util.rect;
    var naboo = require('naboo');
    var viewport = require('viewport');
    function getPopupImgPos(imgWidth, imgHeight) {
        var width = viewport.getWidth();
        var height = Math.round(width * imgHeight / imgWidth);
        var top = (viewport.getHeight() - height) / 2;
        return {
            width: width,
            height: height,
            left: 0,
            top: top
        };
    }
    var getImgOffset = function (img) {
        var imgOffset = rect.getElementOffset(img);
        return imgOffset;
    };
    // 创建弹层 dom
    function createPopup(element, img) {
        var mipPopWrap = document.querySelector('.mip-img-popUp-wrapper');
        if (!!mipPopWrap && mipPopWrap.getAttribute('data-name') === 'mip-img-popUp-name' && mipPopWrap.parentNode.tagName.toLowerCase() === 'body') {
            mipPopWrap.querySelector('img').setAttribute('src', img.src);
            return mipPopWrap;
        }
        var popup = document.createElement('div');
        // 阻止纵向滑动
        new Gesture(popup, { preventY: true });
        popup.className = 'mip-img-popUp-wrapper';
        popup.setAttribute('data-name', 'mip-img-popUp-name');
        /*
        * 创建图片预览图层
        */
        var popUpBg = document.createElement('div');
        var innerImg = new Image();
        popUpBg.className = 'mip-img-popUp-bg';
        innerImg.className = 'mip-img-popUp-innerimg';
        innerImg.src = img.src;
        popup.appendChild(popUpBg);
        popup.appendChild(innerImg);
        document.body.appendChild(popup);
        return popup;
    }
    function bindPopup(element, img) {
        var popup;
        var popupBg;
        var popupImg;
        // 图片点击时展现图片
        img.addEventListener('click', function (event) {
            event.stopPropagation();
            // 图片未加载则不弹层
            if (img.width + img.naturalWidth === 0) {
                return;
            }
            var onResize = function () {
                imgOffset = getImgOffset(img);
                css(popupImg, imgOffset);
                naboo.animate(popupImg, getPopupImgPos(imgOffset.width, imgOffset.height)).start();
            };
            window.addEventListener('resize', onResize);
            popup = createPopup(element, img);
            popupBg = popup.querySelector('.mip-img-popUp-bg');
            popupImg = popup.querySelector('img');
            popup.addEventListener('click', imagePop, false);
            function imagePop() {
                naboo.animate(popupBg, { opacity: 0 }).start();
                naboo.animate(popupImg, getImgOffset(img)).start(function () {
                    css(img, 'visibility', 'visible');
                    css(popup, 'display', 'none');
                });
                popup.removeEventListener('click', imagePop, false);
            }
            var imgOffset = getImgOffset(img);
            css(popupImg, imgOffset);
            css(popupBg, 'opacity', 1);
            css(popup, 'display', 'block');
            naboo.animate(popupImg, getPopupImgPos(imgOffset.width, imgOffset.height)).start();
            css(img, 'visibility', 'hidden');
            css(img.parentNode, 'zIndex', 'inherit');
        }, false);
    }
    var bindLoad = function (element, img) {
        img.addEventListener('load', function () {
            element.classList.add('mip-img-loaded');
            element.customElement.resourcesComplete();
        });
    };
    function firstInviewCallback() {
        var ele = this.element.querySelector('img');
        if (ele && ele.length > 0) {
            return;
        }
        var _img = new Image();
        this.applyFillContent(_img, true);
        var ele = this.element;
        var src = util.makeCacheUrl(ele.getAttribute('src'), 'img');
        _img.src = src;
        if (ele.getAttribute('alt')) {
            _img.setAttribute('alt', ele.getAttribute('alt'));
        }
        ele.appendChild(_img);
        if (ele.hasAttribute('popup')) {
            bindPopup(ele, _img);
        }
        bindLoad(ele, _img);
    }
    customElem.prototype.firstInviewCallback = firstInviewCallback;
    customElem.prototype.hasResources = function () {
        return true;
    };
    return customElem;
});

// ======================
// src/components/mip-pix.js
// ======================


/**
 * @file mip-pix 统计组件
 * @author baidu-authors, liangjiaying<jiaojiaomao220@163.com>
 */
define('components/mip-pix', [
    'require',
    'customElement',
    'util'
], function (require) {
    var customElem = require('customElement').create();
    var util = require('util');
    /**
     * 替换请求链接中的参数
     *
     * @param {string} src      用户填写在mip-pix中的src
     * @param {string} paraName key, 如"title"
     * @param {string} paraVal  value, 如当前时间戳
     * @return {string} url
     */
    function addParas(src, paraName, paraVal) {
        var paraNameQ = new RegExp('\\$?{' + paraName + '}', 'g');
        if (src.search(paraNameQ) > -1) {
            return src.replace(paraNameQ, paraVal);
        }
        src += src.indexOf('?') > -1 ? '&' : '?';
        return src + paraName + '=' + paraVal;
    }
    /**
     * 从body获取mip-expeirment实验分组
     *
     * @param  {string} attr 实验名
     * @return {string}      实验分组
     */
    function getBodyAttr(attr) {
        var body = document.getElementsByTagName('body')[0];
        return body.getAttribute(attr) || 'default';
    }
    customElem.prototype.firstInviewCallback = function () {
        // 获取统计所需参数
        var ele = this.element;
        var src = ele.getAttribute('src');
        var host = window.location.href;
        var title = (document.querySelector('title') || {}).innerHTML || '';
        var time = Date.now();
        // 替换通用参数
        src = addParas(src, 'TIME', time);
        src = addParas(src, 'TITLE', encodeURIComponent(title));
        src = addParas(src, 'HOST', encodeURIComponent(host));
        // 增加对<mip-experiment>支持，获取实验分组
        var expReg = /MIP-X-((\w|-|\d|_)+)/g;
        var matchExpArr = src.match(expReg);
        for (var i in matchExpArr) {
            var matchExp = matchExpArr[i];
            src = addParas(src, matchExp, getBodyAttr(matchExp));
        }
        // 去除匹配失败的其餘{參數}
        src = src.replace(/\$?{.+?}/g, '');
        // 去除其餘 '${', '{', '}' 確保輸出不包含 MIP 定义的语法
        src = src.replace(/\$?{|}/g, '');
        // 创建请求img
        var image = new Image();
        image.src = src;
        image.setAttribute('width', 0);
        image.setAttribute('height', 0);
        ele.setAttribute('width', '');
        ele.setAttribute('height', '');
        ele.appendChild(image);
        util.css(ele, { display: 'none' });
    };
    return customElem;
});

// ======================
// src/components/mip-carousel.js
// ======================


/**
 * @file mip-carousel 轮播组件
 *
 * @author fengchuantao
 * @modify wangpei07 2016-11-30
 */
define('components/mip-carousel', [
    'require',
    'customElement'
], function (require) {
    var customElem = require('customElement').create();
    var carouselParas = {
        boxClass: 'mip-carousel-container',
        wrapBoxClass: 'mip-carousel-wrapper',
        slideBox: 'mip-carousel-slideBox',
        activeitem: 'mip-carousel-activeitem',
        threshold: 0.2
    };
    // 按tagName创建一个固定class的tag
    function createTagWithClass(className, tagName) {
        tagName = tagName || 'div';
        var tag = document.createElement(tagName);
        tag.className = className || '';
        return tag;
    }
    // 获取carouse标签下所有非mip layout引入的元素
    function getChildNodes(element) {
        var allChildNodes = element.children;
        var arrNode = Array.prototype.slice.call(allChildNodes);
        var childList = [];
        arrNode.map(function (ele, i) {
            if (ele.tagName.toLowerCase() !== 'mip-i-space') {
                // 如果是 autoplay，则不允许有 popup 功能
                if (element.hasAttribute('autoplay')) {
                    if (ele.hasAttribute('popup')) {
                        ele.removeAttribute('popup');
                    }
                }
                childList.push(ele);
                element.removeChild(ele);
            }
        });
        if (childList.length > 0) {
            // 拷贝第一个和最后一个节点拼接dom
            var firstCard = childList[0].cloneNode(true);
            var endCard = childList[childList.length - 1].cloneNode(true);
            childList.unshift(endCard);
            childList.push(firstCard);
        }
        return childList;
    }
    // 移动函数
    function translateFn(value, time, wrapBox) {
        wrapBox.style.webkitTransform = 'translate3d(' + value + 'px, 0px, 0px)';
        wrapBox.style.transitionDuration = time;
    }
    // 移出class
    function removeClass(dom, className) {
        if (!dom) {
            return;
        }
        var curClassName = dom.className;
        dom.className = curClassName.replace(className, '').replace(/(^\s*)|(\s*$)/g, '');
    }
    // 追加class
    function addClass(dom, className) {
        if (!dom) {
            return;
        }
        var curClassName = dom.className;
        if (!curClassName) {
            dom.className = className;
        } else {
            dom.className = curClassName + ' ' + className;
        }
    }
    /**
     * 计算滚动之后需要到达的坐标 resetPosAndIdx
     * @param {int} curIndex
     * @param {int} totalNum
     * @param {int} deviceWidth
     * @param {int} endPosition
     * @return {Object}
     */
    function resetPosAndIdx(curIndex, totalNum, deviceWidth, endPos) {
        var endInfo = {
            endPos: 0,
            endIndex: curIndex
        };
        if (curIndex === totalNum - 1) {
            endInfo.endPos = -deviceWidth;
            endInfo.endIndex = 1;
        } else if (curIndex === 0) {
            // if it is last one
            endInfo.endPos = -(totalNum - 2) * deviceWidth;
            endInfo.endIndex = totalNum - 2;
        } else {
            endInfo.endPos = endPos;
        }
        return endInfo;
    }
    // changeIndicatorStyle
    function changeIndicatorStyle(startDot, endDot, className) {
        removeClass(startDot, className);
        addClass(endDot, className);
    }
    customElem.prototype.build = function () {
        var ele = this.element;
        var self = this;
        var eleWidth = ele.clientWidth;
        var dotItems = [];
        // 获取用户填写属性
        // 是否自动播放
        var isAutoPlay = ele.hasAttribute('autoplay');
        // 图片间隔时长默认为4000
        var isDefer = ele.getAttribute('defer');
        var isDeferNum = !!isDefer ? isDefer : 4000;
        // 分页显示器
        var showPageNum = ele.hasAttribute('indicator');
        // 翻页按钮
        var showBtn = ele.hasAttribute('buttonController');
        // 翻页按钮
        var indicatorId = ele.getAttribute('indicatorId');
        // Gesture锁
        var slideLock = { stop: 1 };
        // btn按钮手势锁
        var btnLock = { stop: 1 };
        // 缓存上一次手势位置
        var prvGestureClientx = 0;
        // 缓存当前值轮播位置
        var curGestureClientx = -eleWidth;
        // 当前图片显示索引
        var imgIndex = 1;
        // 定时器时间hold
        var moveInterval;
        // 禁止左右滑动配置
        var startPos = {};
        var endPos = {};
        var isScrolling = 0;
        // 获取carousel下的所有节点
        var childNodes = getChildNodes(ele);
        // 图片显示个数
        // 其实图片个数应该为实际个数+2.copy了头和尾的两部分
        var childNum = childNodes.length;
        // length 等于0时，不做任何处理
        if (childNum === 0) {
            return;
        }
        // 将getChildNodes获取的元素拼装轮播dom
        var carouselBox = createTagWithClass(carouselParas.boxClass);
        var wrapBox = createTagWithClass(carouselParas.wrapBoxClass);
        childNodes.map(function (ele, i) {
            var slideBox = createTagWithClass(carouselParas.slideBox);
            slideBox.appendChild(ele);
            slideBox.style.width = 100 / childNum + '%';
            wrapBox.appendChild(slideBox);
            // 遍历mip-img计算布局
            self.applyFillContent(ele, true);
            // inview callback  bug, TODO
            var MIP = window.MIP || {};
            MIP.prerenderElement(ele);
            var allImgs = ele.querySelectorAll('mip-img');
            var len = allImgs.length;
            for (var idx = 0; idx < len; idx++) {
                self.applyFillContent(allImgs[idx], true);
                MIP.prerenderElement(allImgs[idx]);
            }
        });
        wrapBox.style.width = childNum * 100 + '%';
        carouselBox.appendChild(wrapBox);
        ele.appendChild(carouselBox);
        // 初始渲染时应该改变位置到第一张图
        var initPostion = -eleWidth;
        wrapBox.style.webkitTransform = 'translate3d(' + initPostion + 'px, 0, 0)';
        // 绑定wrapBox的手势事件
        // 手势移动的距离
        var diffNum = 0;
        // 绑定手势点击事件
        wrapBox.addEventListener('touchstart', function (event) {
            // 以下兼容横屏时禁止左右滑动
            var touch = event.targetTouches[0];
            startPos = {
                x: touch.pageX,
                y: touch.pageY,
                time: +new Date()
            };
            isScrolling = 0;
            // 这个参数判断是垂直滚动还是水平滚动
            // 获取手势点击位置
            prvGestureClientx = touch.pageX;
            clearInterval(moveInterval);
        }, false);
        wrapBox.addEventListener('touchmove', function (event) {
            // 阻止触摸事件的默认行为，即阻止滚屏
            var touch = event.targetTouches[0];
            endPos = {
                x: touch.pageX - startPos.x,
                y: touch.pageY - startPos.y
            };
            isScrolling = Math.abs(endPos.x) < Math.abs(endPos.y) ? 1 : 0;
            // isScrolling为1时，表示纵向滑动，0为横向滑动
            if (isScrolling === 0) {
                event.preventDefault();
            }
            // 获取手指移动的距离
            diffNum = event.targetTouches[0].pageX - prvGestureClientx;
            // 外框同步运动
            translateFn(diffNum + curGestureClientx, '0ms', wrapBox);
            // 滚动手势锁 正在滑动
            slideLock.stop = 0;
        }, false);
        wrapBox.addEventListener('touchend', function (event) {
            //  只有滑动之后才会触发
            if (!slideLock.stop) {
                var startIdx = imgIndex;
                var endIdx = startIdx;
                // 如果大于设定阈值
                if (Math.abs(diffNum) > eleWidth * carouselParas.threshold) {
                    endIdx = diffNum > 0 ? imgIndex - 1 : imgIndex + 1;
                }
                move(wrapBox, startIdx, endIdx);
                slideLock.stop = 1;
            }
            // 如果存在自动则调用自动轮播
            if (isAutoPlay) {
                clearInterval(moveInterval);
                autoPlay();
            }
        }, false);
        // 自动轮播
        if (!!isAutoPlay) {
            autoPlay();
        }
        // 指示器
        if (!!showPageNum) {
            indicator();
        }
        // 控制按钮
        if (!!showBtn) {
            cratebutton();
        }
        // 是否关联indicator
        if (!!indicatorId) {
            indicatorDot(indicatorId);
        }
        // 自动轮播
        function autoPlay() {
            moveInterval = setInterval(function () {
                move(wrapBox, imgIndex, imgIndex + 1);
            }, isDeferNum);
        }
        // 创建指示器
        function indicator() {
            var indicatorBox = createTagWithClass('mip-carousel-indicatorbox');
            var indicatorBoxWrap = createTagWithClass('mip-carousel-indicatorBoxwrap', 'p');
            var indicatorNow = createTagWithClass('mip-carousel-indicatornow', 'span');
            var indicatorAllNum = createTagWithClass('', 'span');
            indicatorAllNum.innerHTML = '/' + (childNum - 2);
            indicatorNow.innerHTML = imgIndex;
            indicatorBoxWrap.appendChild(indicatorNow);
            indicatorBoxWrap.appendChild(indicatorAllNum);
            indicatorBox.appendChild(indicatorBoxWrap);
            ele.appendChild(indicatorBox);
        }
        // 指示器数字变化
        function indicatorChange(idx) {
            if (!showPageNum) {
                return;
            }
            var indicatorNow = ele.querySelector('.mip-carousel-indicatornow');
            indicatorNow.innerHTML = idx;
        }
        // 创建左右轮播切换btn
        function cratebutton() {
            var preBtn = document.createElement('p');
            preBtn.className = 'mip-carousel-preBtn';
            var nextBtn = document.createElement('p');
            nextBtn.className = 'mip-carousel-nextBtn';
            ele.appendChild(preBtn);
            ele.appendChild(nextBtn);
            bindBtn();
        }
        // 绑定按钮切换事件
        function bindBtn() {
            ele.querySelector('.mip-carousel-preBtn').addEventListener('click', function (event) {
                if (!btnLock.stop) {
                    return;
                }
                btnLock.stop = 0;
                imgIndex = imgIndex - 1;
                clearInterval(moveInterval);
                move(wrapBox, imgIndex + 1, imgIndex);
                if (isAutoPlay) {
                    autoPlay();
                }
            }, false);
            ele.querySelector('.mip-carousel-nextBtn').addEventListener('click', function (event) {
                if (!btnLock.stop) {
                    return;
                }
                btnLock.stop = 0;
                imgIndex = imgIndex + 1;
                clearInterval(moveInterval);
                move(wrapBox, imgIndex - 1, imgIndex);
                if (isAutoPlay) {
                    autoPlay();
                }
            }, false);
        }
        // 图片滑动处理与手势滑动函数endPosition为最终距离,Duration变换时间
        function move(wrapBox, startIdx, endIdx, Duration) {
            if (!wrapBox) {
                return;
            }
            // 双保险，确认位移的是 ele 的 width
            if (eleWidth !== ele.clientWidth) {
                eleWidth = ele.clientWidth;
            }
            imgIndex = endIdx;
            var endPosition = -eleWidth * endIdx;
            if (Duration) {
                translateFn(endPosition, '0ms', wrapBox);
                wrapBox.style.transitionDuration = '0ms';
            } else {
                translateFn(endPosition, '300ms', wrapBox);
                wrapBox.style.transitionDuration = '300ms';
            }
            // resetPosAndIdx
            var posIdxObj = resetPosAndIdx(imgIndex, childNum, eleWidth, endPosition);
            curGestureClientx = posIdxObj.endPos;
            endIdx = posIdxObj.endIndex;
            imgIndex = endIdx;
            // 如果有指示器，需更新选中位置的样式
            if (dotItems.length > 0) {
                changeIndicatorStyle(dotItems[startIdx - 1], dotItems[endIdx - 1], carouselParas.activeitem);
            }
            // 如果切换了坐标，需要在动画结束后重置translatex位置
            if (curGestureClientx !== endPosition) {
                setTimeout(function () {
                    translateFn(curGestureClientx, '0ms', wrapBox);
                    btnLock.stop = 1;
                }, 300);
            }
            btnLock.stop = 1;
            indicatorChange(imgIndex);
        }
        // 处理圆点型指示器
        function indicatorDot(domId) {
            var indicDom = document.getElementById(domId);
            if (!indicDom) {
                return;
            }
            dotItems = indicDom.children;
            var dotLen = dotItems.length;
            if (dotLen === childNum - 2) {
                for (var i = 0; i < dotLen; i++) {
                    dotItems[i].count = i;
                    dotItems[i].addEventListener('click', function (event) {
                        var count = this.count;
                        clearInterval(moveInterval);
                        move(wrapBox, imgIndex, count + 1);
                        if (isAutoPlay) {
                            autoPlay();
                        }
                    });
                }
            } else {
                // 若个数不匹配，则隐藏掉indicator
                indicDom.style.display = 'none';
                dotItems = [];
            }
        }
        // 横竖屏兼容处理
        window.addEventListener('resize', function () {
            eleWidth = ele.clientWidth;
            move(wrapBox, imgIndex, imgIndex, '0ms');
        }, false);
    };
    return customElem;
});

// ======================
// src/components/mip-iframe.js
// ======================


define('components/mip-iframe', [
    'require',
    'customElement',
    'util'
], function (require) {
    var customElem = require('customElement').create();
    var util = require('util');
    var attrList = [
        'allowfullscreen',
        'allowtransparency',
        'sandbox'
    ];
    customElem.prototype.build = function () {
        var element = this.element;
        var src = element.getAttribute('src');
        var srcdoc = element.getAttribute('srcdoc');
        if (srcdoc) {
            src = 'data:text/html;charset=utf-8;base64,' + window.btoa(srcdoc);
        }
        var height = element.getAttribute('height');
        var width = element.getAttribute('width') || '100%';
        if (!src || !height) {
            return;
        }
        var iframe = document.createElement('iframe');
        iframe.frameBorder = '0';
        iframe.scrolling = 'no';
        util.css(iframe, {
            width: width,
            height: height
        });
        this.applyFillContent(iframe);
        iframe.src = src;
        this.expendAttr(attrList, iframe);
        element.appendChild(iframe);
    };
    return customElem;
});

// ======================
// src/components/mip-video.js
// ======================


/**
 * @file 视频播放组件
 * @author @author harttle<yangjun14@baidu.com>, liangjiaying<jennyliang220@github>
 * @version 1.0
 * @copyright 2016 Baidu.com, Inc. All Rights Reserved
 */
define('components/mip-video', [
    'require',
    'customElement',
    'viewer'
], function (require) {
    var customElem = require('customElement').create();
    var viewer = require('viewer');
    var videoAttributes = [
        'ads',
        'src',
        'controls',
        'loop',
        'autoplay',
        'autoplay',
        'autobuffer',
        'crossorigin',
        'height',
        'muted',
        'preload',
        'poster',
        'width'
    ];
    var windowInIframe = viewer.isIframed;
    customElem.prototype.firstInviewCallback = function () {
        this.attributes = getAttributeSet(this.element.attributes);
        // 窗口是否是https
        var windowProHttps = !!window.location.protocol.match(/^https:/);
        // 判断src是否https
        var videoProHttps = !!this.attributes.src.match(/^https:/);
        // 页面https         + 视频https  = 当前页播放
        // 页面https(在iframe里) + 视频http    = 跳出播放
        // 页面https(其它)   + 视频http    = 当前页播放（非mip相关页）
        // 页面http          + 视频任意    = 当前页播放
        // 如果非iframe嵌套时，应该与协议无关 || 如果src为https ||  窗口内 + video http + 窗口http
        if (!windowInIframe || videoProHttps || windowInIframe && !videoProHttps && !windowProHttps) {
            this.videoElement = this.renderInView();
        } else {
            // 处理在窗口内，视频或者窗口非https的情况
            this.videoElement = this.renderPlayElsewhere();
        }
        this.applyFillContent(this.videoElement, true);
    };
    // Render the `<video>` element, and append to `this.element`
    customElem.prototype.renderInView = function () {
        var videoEl = document.createElement('video');
        for (var k in this.attributes) {
            if (this.attributes.hasOwnProperty(k) && videoAttributes.indexOf(k) > -1) {
                videoEl.setAttribute(k, this.attributes[k]);
                videoEl.setAttribute('playsinline', 'playsinline');
                videoEl.setAttribute('webkit-playsinline', 'webkit-playsinline');
            }
        }
        Array.prototype.slice.apply(this.element.childNodes).forEach(function (node) {
            // FIXME: mip layout related, remove this!
            if (node.nodeName.toLowerCase() === 'mip-i-space') {
                return;
            }
            videoEl.appendChild(node);
        });
        this.element.appendChild(videoEl);
        return videoEl;
    };
    // Render the `<a>` element with poster and play btn, and append to `this.element`
    customElem.prototype.renderPlayElsewhere = function () {
        var videoEl = document.createElement('div');
        videoEl.setAttribute('class', 'mip-video-poster');
        if (this.attributes.poster) {
            videoEl.style.backgroundImage = 'url(' + this.attributes.poster + ')';
            videoEl.style.backgroundSize = 'cover';
        } else {
            videoEl.style.background = '#333';
        }
        var playBtn = document.createElement('span');
        playBtn.setAttribute('class', 'mip-video-playbtn');
        videoEl.appendChild(playBtn);
        videoEl.dataset.videoSrc = this.attributes.src;
        videoEl.dataset.videoPoster = this.attributes.poster;
        videoEl.addEventListener('click', sendVideoMessage, false);
        function sendVideoMessage() {
            if (windowInIframe) {
                // mip_video_jump 为写在外层的承接方法
                viewer.sendMessage('mip_video_jump', {
                    poster: videoEl.dataset.videoPoster,
                    src: videoEl.dataset.videoSrc
                });
            }
        }
        this.element.appendChild(videoEl);
        return videoEl;
    };
    /**
     * Get attribute Set from attribute List
     *
     * @param {NamedNodeMap} attributes the attribute list, spec: https://dom.spec.whatwg.org/#interface-namednodemap
     * @return {Object} the attribute set, legacy:
     * @example
     * {
     *     "src": "http://xx.mp4",
     *     "autoplay": "",
     *     "width": "720"
     * }
     */
    function getAttributeSet(attributes) {
        var attrs = {};
        Array.prototype.slice.apply(attributes).forEach(function (attr) {
            attrs[attr.name] = attr.value;
        });
        return attrs;
    }
    return customElem;
});

// ======================
// src/components/index.js
// ======================


/**
 * Builtins register
 */
define('components/index', [
    'require',
    '../element',
    './mip-pix',
    './mip-img',
    './mip-carousel',
    './mip-iframe',
    './mip-video'
], function (require) {
    'use strict';
    /**
     * Register the builtin components.
     */
    function register() {
        var registerEle = require('../element');
        registerEle('mip-pix', require('./mip-pix'));
        registerEle('mip-img', require('./mip-img'));
        registerEle('mip-carousel', require('./mip-carousel'));
        registerEle('mip-iframe', require('./mip-iframe'));
        registerEle('mip-video', require('./mip-video'));
    }
    ;
    return { register: register };
});

// ======================
// src/mip.js
// ======================


define('mip', [
    'require',
    'zepto',
    'naboo',
    './dom/dom',
    'fetch-jsonp',
    'fetch',
    './utils/fn',
    './utils/gesture/gesture-recognizer',
    './utils/gesture/data-processor',
    './utils/gesture',
    './utils/platform',
    './utils/event-emitter',
    './utils/event-action',
    './dom/css-loader',
    './dom/rect',
    './dom/event',
    './dom/css',
    './utils/customStorage',
    './sleepWakeModule',
    './layout',
    './fixed-element',
    './viewport',
    './customElement',
    './element',
    './util',
    './resources',
    './viewer',
    './performance',
    './templates',
    './hash',
    './components/mip-img',
    './components/mip-pix',
    './components/mip-carousel',
    './components/mip-iframe',
    './components/index'
], function (require) {
    require('zepto');
    require('naboo');
    /* dom */
    var dom = require('./dom/dom');
    // The global variable of MIP
    var Mip = {};
    if (window.MIP) {
        var exts = window.MIP;
        window.MIP = Mip;
        MIP.extensions = exts;
    } else {
        window.MIP = Mip;
    }
    // before document ready
    MIP.push = function (extensions) {
        if (!MIP.extensions) {
            MIP.extensions = [];
        }
        MIP.extensions.push(extensions);
    };
    dom.waitDocumentReady(function () {
        require('fetch-jsonp');
        require('fetch');
        require('./utils/fn');
        require('./utils/gesture/gesture-recognizer');
        require('./utils/gesture/data-processor');
        require('./utils/gesture');
        require('./utils/platform');
        require('./utils/event-emitter');
        require('./utils/event-action');
        require('./dom/css-loader');
        require('./dom/rect');
        require('./dom/event');
        require('./dom/css');
        var CustomStorage = require('./utils/customStorage');
        var sleepWakeModule = require('./sleepWakeModule');
        /* mip frame */
        var layout = require('./layout');
        require('./fixed-element');
        var viewport = require('./viewport');
        require('./customElement');
        var registerElement = require('./element');
        require('./util');
        var resources = require('./resources');
        var viewer = require('./viewer');
        var performance = require('./performance');
        var templates = require('./templates');
        /* mip hash */
        var hash = require('./hash');
        /* builtin components */
        require('./components/mip-img');
        require('./components/mip-pix');
        require('./components/mip-carousel');
        require('./components/mip-iframe');
        var components = require('./components/index');
        Mip.css = {};
        Mip.viewer = viewer;
        Mip.viewport = viewport;
        Mip.prerenderElement = resources.prerenderElement;
        Mip.registerMipElement = function (name, customClass, css) {
            if (templates.isTemplateClass(customClass)) {
                templates.register(name, customClass);
            } else {
                registerElement(name, customClass, css);
            }
        };
        MIP.hash = hash;
        // Initialize sleepWakeModule
        sleepWakeModule.init();
        // Initialize viewer
        viewer.init();
        // Find the default-hidden elements.
        var hiddenElements = Array.prototype.slice.call(document.getElementsByClassName('mip-hidden'));
        // Regular for checking mip elements.
        var mipTagReg = /mip-/i;
        // Apply layout for default-hidden elements.
        hiddenElements.forEach(function (element) {
            if (element.tagName.search(mipTagReg) > -1) {
                layout.applyLayout(element);
            }
        });
        // Register builtin extensions
        components.register();
        performance.start(window._mipStartTiming);
        performance.on('update', function (timing) {
            viewer.sendMessage('performance_update', timing);
        });
        // Show page
        viewer.show();
        // clear cookie
        var storage = new CustomStorage(2);
        storage.delExceedCookie();
    });
    return Mip;
});

require.config({
    paths: {
        'searchbox/openjs/aio': '//m.baidu.com/static/searchbox/openjs/aio.js?v=201606',
        'jquery': '//mipcache.bdstatic.com/static/v1/deps/jquery'
    }
});

require(['mip']);
