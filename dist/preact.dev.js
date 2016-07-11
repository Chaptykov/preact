(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (factory((global.preact = global.preact || {})));
}(this, function (exports) {

  function VNode(nodeName, attributes, children) {
  	/** @type {string|function} */
  	this.nodeName = nodeName;

  	/** @type {object<string>|undefined} */
  	this.attributes = attributes;

  	/** @type {array<VNode>|undefined} */
  	this.children = children;

  	/** Reference to the given key. */
  	this.key = attributes && attributes.key;
  }

  var NO_RENDER = 0;
  var SYNC_RENDER = 1;
  var FORCE_RENDER = 2;

  var EMPTY = {};
  var EMPTY_BASE = '';

  var ATTR_KEY = typeof Symbol !== 'undefined' ? Symbol['for']('preactattr') : '__preactattr_';

  // DOM properties that should NOT have "px" added when numeric
  var NON_DIMENSION_PROPS = {
  	boxFlex: 1, boxFlexGroup: 1, columnCount: 1, fillOpacity: 1, flex: 1, flexGrow: 1,
  	flexPositive: 1, flexShrink: 1, flexNegative: 1, fontWeight: 1, lineClamp: 1, lineHeight: 1,
  	opacity: 1, order: 1, orphans: 1, strokeOpacity: 1, widows: 1, zIndex: 1, zoom: 1
  };

  /** Copy own-properties from `props` onto `obj`.
   *	@returns obj
   *	@private
   */

  function extend(obj, props) {
  	if (props) {
  		for (var i in props) {
  			if (props[i] !== undefined) {
  				obj[i] = props[i];
  			}
  		}
  	}
  	return obj;
  }

  /** Fast clone. Note: does not filter out non-own properties.
   *	@see https://esbench.com/bench/56baa34f45df6895002e03b6
   */

  function clone(obj) {
  	return extend({}, obj);
  }

  /** Create a caching wrapper for the given function.
   *	Note: As this method is only used for memoizing string operations, it does not safeguard against Object.prototype manipulation.
   *	@private
   */

  function memoize(fn) {
  	var mem = {};
  	return function (k) {
  		return mem[k] || (mem[k] = fn(k));
  	};
  }

  /** Get a deep property value from the given object, expressed in dot-notation.
   *	@private
   */

  function delve(obj, key) {
  	for (var p = key.split('.'), i = 0; i < p.length && obj; i++) {
  		obj = obj[p[i]];
  	}
  	return obj;
  }

  /** Convert an Array-like object to an Array
   *	@private
   */

  function toArray(obj, offset) {
  	return [].slice.call(obj, offset);
  }

  /** @private is the given object a Function? */

  function isFunction(obj) {
  	return 'function' === typeof obj;
  }

  /** @private is the given object a String? */

  function isString(obj) {
  	return 'string' === typeof obj;
  }

  /** Check if a value is `null` or `undefined`.
   *	@private
   */

  function empty(x) {
  	return x === undefined || x === null;
  }

  /** Check if a value is `null`, `undefined`, or explicitly `false`. */

  function falsey(value) {
  	return value === false || empty(value);
  }

  /** Convert a hashmap of styles to CSSText
   *	@private
   */

  function styleObjToCss(s) {
  	var str = '';
  	for (var prop in s) {
  		var val = s[prop];
  		if (!empty(val)) {
  			if (str) str += ' ';
  			str += jsToCss(prop);
  			str += ': ';
  			str += val;
  			if (typeof val === 'number' && !NON_DIMENSION_PROPS[prop]) {
  				str += 'px';
  			}
  			str += ';';
  		}
  	}
  	return str;
  }

  /** Convert a hashmap of CSS classes to a space-delimited className string
   *	@private
   */

  function hashToClassName(c) {
  	var str = '';
  	for (var prop in c) {
  		if (c[prop]) {
  			if (str) str += ' ';
  			str += prop;
  		}
  	}
  	return str;
  }

  /** Convert a JavaScript camel-case CSS property name to a CSS property name
   *	@private
   *	@function
   */
  var jsToCss = memoize(function (s) {
  	return toLowerCase(s.replace(/([A-Z])/g, '-$1'));
  });

  /** Just a memoized String.prototype.toLowerCase */
  var toLowerCase = memoize(function (s) {
  	return s.toLowerCase();
  });

  // For animations, rAF is vastly superior. However, it scores poorly on benchmarks :(
  // export const setImmediate = typeof requestAnimationFrame==='function' ? requestAnimationFrame : setTimeout;

  /** Call a function asynchronously, as soon as possible.
   *	@param {Function} callback
   */
  var resolved = typeof Promise !== 'undefined' && Promise.resolve();
  var setImmediate = resolved ? function (f) {
  	resolved.then(f);
  } : setTimeout;

  /** Global options
   *	@public
   *	@namespace options {Object}
   */
  var options = {

  	/** If `true`, `prop` changes trigger synchronous component updates.
    *	@name syncComponentUpdates
    *	@type Boolean
    *	@default true
    */
  	//syncComponentUpdates: true,

  	/** Processes all created VNodes.
    *	@param {VNode} vnode	A newly-created VNode to normalize/process
    */
  	vnode: empty
  };

  /** Invoke a hook on the `options` export. */

  function optionsHook(name, a) {
  	return hook(options, name, a);
  }

  /** Invoke a "hook" method with arguments if it exists.
   *	@private
   */

  function hook(obj, name, a, b, c) {
  	if (obj[name]) return obj[name](a, b, c);
  }

  /** Invoke hook() on a component and child components (recursively)
   *	@private
   */

  function deepHook(obj, type) {
  	do {
  		hook(obj, type);
  	} while (obj = obj._component);
  }

  var SHARED_TEMP_ARRAY = [];

  /** JSX/hyperscript reviver
   *	@see http://jasonformat.com/wtf-is-jsx
   *	@public
   *  @example
   *  /** @jsx h *\/
   *  import { render, h } from 'preact';
   *  render(<span>foo</span>, document.body);
   */

  function h(nodeName, attributes, firstChild) {
  	var len = arguments.length,
  	    children,
  	    arr,
  	    lastSimple;

  	if (len > 2) {
  		var type = typeof firstChild;
  		if (len === 3 && type !== 'object' && type !== 'function') {
  			if (!falsey(firstChild)) {
  				children = [String(firstChild)];
  			}
  		} else {
  			children = [];
  			for (var i = 2; i < len; i++) {
  				var _p = arguments[i];
  				if (falsey(_p)) continue;
  				if (_p.join) arr = _p;else (arr = SHARED_TEMP_ARRAY)[0] = _p;
  				for (var j = 0; j < arr.length; j++) {
  					var child = arr[j],
  					    simple = !(falsey(child) || isFunction(child) || child instanceof VNode);
  					if (simple && !isString(child)) child = String(child);
  					if (simple && lastSimple) {
  						children[children.length - 1] += child;
  					} else if (!falsey(child)) {
  						children.push(child);
  						lastSimple = simple;
  					}
  				}
  			}
  		}
  	} else if (attributes && attributes.children) {
  		return h(nodeName, attributes, attributes.children);
  	}

  	if (attributes) {
  		if (attributes.children) {
  			delete attributes.children;
  		}

  		if (!isFunction(nodeName)) {
  			// normalize className to class.
  			if ('className' in attributes) {
  				attributes['class'] = attributes.className;
  				delete attributes.className;
  			}

  			lastSimple = attributes['class'];
  			if (lastSimple && !isString(lastSimple)) {
  				attributes['class'] = hashToClassName(lastSimple);
  			}

  			lastSimple = attributes.style;
  			if (lastSimple && !isString(lastSimple)) {
  				attributes.style = styleObjToCss(lastSimple);
  			}
  		}
  	}

  	var p = new VNode(nodeName, attributes || undefined, children);
  	optionsHook('vnode', p);
  	return p;
  }

  function cloneElement(vnode, props) {
  	return h(vnode.nodeName, extend(clone(vnode.attributes), props), arguments.length > 2 ? toArray(arguments, 2) : vnode.children);
  }

  /** Create an Event handler function that sets a given state property.
   *	@param {Component} component	The component whose state should be updated
   *	@param {string} key				A dot-notated key path to update in the component's state
   *	@param {string} eventPath		A dot-notated key path to the value that should be retrieved from the Event or component
   *	@returns {function} linkedStateHandler
   *	@private
   */

  function createLinkedState(component, key, eventPath) {
  	var path = key.split('.'),
  	    p0 = path[0],
  	    len = path.length;
  	return function (e) {
  		var _component$setState;

  		var t = e && e.currentTarget || this,
  		    s = component.state,
  		    obj = s,
  		    v,
  		    i;
  		if (isString(eventPath)) {
  			v = delve(e, eventPath);
  			if (empty(v) && (t = t._component)) {
  				v = delve(t, eventPath);
  			}
  		} else {
  			v = (t.nodeName + t.type).match(/^input(check|rad)/i) ? t.checked : t.value;
  		}
  		if (isFunction(v)) v = v.call(t);
  		if (len > 1) {
  			for (i = 0; i < len - 1; i++) {
  				obj = obj[path[i]] || (obj[path[i]] = {});
  			}
  			obj[path[i]] = v;
  			v = s[p0];
  		}
  		component.setState((_component$setState = {}, _component$setState[p0] = v, _component$setState));
  	};
  }

  var items = [];
  var itemsOffline = [];
  function enqueueRender(component) {
  	if (items.push(component) !== 1) return;

  	(options.debounceRendering || setImmediate)(rerender);
  }

  function rerender() {
  	if (!items.length) return;

  	var currentItems = items,
  	    p;

  	// swap online & offline
  	items = itemsOffline;
  	itemsOffline = currentItems;

  	while (p = currentItems.pop()) {
  		if (p._dirty) renderComponent(p);
  	}
  }

  /** Check if a VNode is a reference to a stateless functional component.
   *	A function component is represented as a VNode whose `nodeName` property is a reference to a function.
   *	If that function is not a Component (ie, has no `.render()` method on a prototype), it is considered a stateless functional component.
   *	@param {VNode} vnode	A VNode
   *	@private
   */

  function isFunctionalComponent(vnode) {
    var nodeName = vnode && vnode.nodeName;
    return nodeName && isFunction(nodeName) && !(nodeName.prototype && nodeName.prototype.render);
  }

  /** Construct a resultant VNode from a VNode referencing a stateless functional component.
   *	@param {VNode} vnode	A VNode with a `nodeName` property that is a reference to a function.
   *	@private
   */

  function buildFunctionalComponent(vnode, context) {
    return vnode.nodeName(getNodeProps(vnode), context || EMPTY) || EMPTY_BASE;
  }

  function ensureNodeData(node, data) {
  	return node[ATTR_KEY] || (node[ATTR_KEY] = data || {});
  }

  function getNodeType(node) {
  	if (node instanceof Text) return 3;
  	if (node instanceof Element) return 1;
  	return 0;
  }

  /** Removes a given DOM Node from its parent. */

  function removeNode(node) {
  	var p = node.parentNode;
  	if (p) p.removeChild(node);
  }

  /** Set a named attribute on the given Node, with special behavior for some names and event handlers.
   *	If `value` is `null`, the attribute/handler will be removed.
   *	@param {Element} node	An element to mutate
   *	@param {string} name	The name/key to set, such as an event or attribute name
   *	@param {any} value		An attribute value, such as a function to be used as an event handler
   *	@param {any} previousValue	The last value that was set for this name/node pair
   *	@private
   */

  function setAccessor(node, name, value, isSvg) {
  	ensureNodeData(node)[name] = value;

  	if (name === 'key' || name === 'children') return;

  	if (name === 'class' && !isSvg) {
  		node.className = value || '';
  	} else if (name === 'style') {
  		node.style.cssText = value || '';
  	} else if (name === 'dangerouslySetInnerHTML') {
  		if (value) node.innerHTML = value.__html;
  	} else if (name !== 'type' && !isSvg && name in node) {
  		setProperty(node, name, empty(value) ? '' : value);
  		if (falsey(value)) node.removeAttribute(name);
  	} else if (name[0] === 'o' && name[1] === 'n') {
  		var l = node._listeners || (node._listeners = {});
  		name = toLowerCase(name.substring(2));
  		if (!l[name]) node.addEventListener(name, eventProxy);else if (!value) node.removeEventListener(name, eventProxy);
  		l[name] = value;
  	} else {
  		var ns = isSvg && name.match(/^xlink\:?(.+)/);
  		if (falsey(value)) {
  			if (ns) node.removeAttributeNS('http://www.w3.org/1999/xlink', toLowerCase(ns[1]));else node.removeAttribute(name);
  		} else if (typeof value !== 'object' && !isFunction(value)) {
  			if (ns) node.setAttributeNS('http://www.w3.org/1999/xlink', toLowerCase(ns[1]), value);else node.setAttribute(name, value);
  		}
  	}
  }

  /** Attempt to set a DOM property to the given value.
   *	IE & FF throw for certain property-value combinations.
   */
  function setProperty(node, name, value) {
  	try {
  		node[name] = value;
  	} catch (e) {}
  }

  /** Proxy an event to hooked event handlers
   *	@private
   */
  function eventProxy(e) {
  	return this._listeners[e.type](optionsHook('event', e) || e);
  }

  /** Get a node's attributes as a hashmap.
   *	@private
   */

  function getRawNodeAttributes(node) {
  	var attrs = {};
  	for (var i = node.attributes.length; i--;) {
  		attrs[node.attributes[i].name] = node.attributes[i].value;
  	}
  	return attrs;
  }

  /** Check if two nodes are equivalent.
   *	@param {Element} node
   *	@param {VNode} vnode
   *	@private
   */

  function isSameNodeType(node, vnode) {
  	if (isString(vnode)) return getNodeType(node) === 3;
  	var nodeName = vnode.nodeName,
  	    type = typeof nodeName;
  	if (type === 'string') {
  		return isNamedNode(node, nodeName);
  	}
  	if (type === 'function') {
  		return node._componentConstructor === nodeName || isFunctionalComponent(vnode);
  	}
  }

  function isNamedNode(node, nodeName) {
  	return (node.normalizedNodeName || toLowerCase(node.nodeName)) === toLowerCase(nodeName);
  }

  /**
   * Reconstruct Component-style `props` from a VNode.
   * Ensures default/fallback values from `defaultProps`:
   * Own-properties of `defaultProps` not present in `vnode.attributes` are added.
   * @param {VNode} vnode
   * @returns {Object} props
   */

  function getNodeProps(vnode) {
  	var defaultProps = vnode.nodeName.defaultProps,
  	    props = clone(defaultProps || vnode.attributes);

  	if (defaultProps) extend(props, vnode.attributes);

  	if (vnode.children) props.children = vnode.children;

  	return props;
  }

  /** DOM node pool, keyed on nodeName. */

  var nodes = {};

  function collectNode(node) {
  	cleanNode(node);
  	var name = toLowerCase(node.nodeName),
  	    list = nodes[name];
  	if (list) list.push(node);else nodes[name] = [node];
  }

  function createNode(nodeName, isSvg) {
  	var name = toLowerCase(nodeName),
  	    node = nodes[name] && nodes[name].pop() || (isSvg ? document.createElementNS('http://www.w3.org/2000/svg', nodeName) : document.createElement(nodeName));
  	ensureNodeData(node);
  	node.normalizedNodeName = name;
  	return node;
  }

  function cleanNode(node) {
  	removeNode(node);

  	if (getNodeType(node) === 3) return;

  	// When reclaiming externally created nodes, seed the attribute cache: (Issue #97)

  	ensureNodeData(node, getRawNodeAttributes(node));

  	node._component = node._componentConstructor = null;

  	// if (node.childNodes.length>0) {
  	// 	console.trace(`Warning: Recycler collecting <${node.nodeName}> with ${node.childNodes.length} children.`);
  	// 	for (let i=node.childNodes.length; i--; ) collectNode(node.childNodes[i]);
  	// }
  }

  var SVG_MODE = false;

  /** Apply differences in a given vnode (and it's deep children) to a real DOM Node.
   *	@param {Element} [dom=null]		A DOM node to mutate into the shape of the `vnode`
   *	@param {VNode} vnode			A VNode (with descendants forming a tree) representing the desired DOM structure
   *	@returns {Element} dom			The created/mutated element
   *	@private
   */

  function diff(dom, vnode, context, mountAll, unmountChildrenOnly) {
  	var originalAttributes = vnode.attributes;

  	while (isFunctionalComponent(vnode)) {
  		vnode = buildFunctionalComponent(vnode, context);
  	}

  	if (isString(vnode)) {
  		if (dom) {
  			if (getNodeType(dom) === 3) {
  				if (dom.nodeValue !== vnode) {
  					dom.nodeValue = vnode;
  				}
  				return dom;
  			}
  			if (!unmountChildrenOnly) collectNode(dom);
  		}
  		return document.createTextNode(vnode);
  	}

  	var out = dom,
  	    nodeName = vnode.nodeName,
  	    svgMode;

  	if (isFunction(nodeName)) {
  		return buildComponentFromVNode(dom, vnode, context, mountAll);
  	}
  	if (!isString(nodeName)) {
  		nodeName = String(nodeName);
  	}

  	svgMode = toLowerCase(nodeName) === 'svg';

  	if (svgMode) SVG_MODE = true;

  	if (!dom) {
  		out = createNode(nodeName, SVG_MODE);
  	} else if (!isNamedNode(dom, nodeName)) {
  		out = createNode(nodeName, SVG_MODE);
  		// move children into the replacement node
  		while (dom.firstChild) out.appendChild(dom.firstChild);
  		// reclaim element nodes
  		if (!unmountChildrenOnly) recollectNodeTree(dom);
  	}

  	diffNode(out, vnode.children, context, mountAll);

  	diffAttributes(out, vnode.attributes);

  	if (originalAttributes && originalAttributes.ref) {
  		(out[ATTR_KEY].ref = originalAttributes.ref)(out);
  	}

  	if (svgMode) SVG_MODE = false;

  	return out;
  }

  /** Morph a DOM node to look like the given VNode. Creates DOM if it doesn't exist. */
  function diffNode(dom, vchildren, context, mountAll) {
  	var firstChild = dom.firstChild;
  	if (vchildren && vchildren.length === 1 && typeof vchildren[0] === 'string' && firstChild instanceof Text && dom.childNodes.length === 1) {
  		firstChild.nodeValue = vchildren[0];
  	} else if (vchildren || firstChild) {
  		innerDiffNode(dom, vchildren, context, mountAll);
  	}
  }

  function getKey(child) {
  	var c = child._component;
  	if (c) return c.__key;

  	var data = child[ATTR_KEY];
  	if (data) return data.key;
  }

  /** Apply child and attribute changes between a VNode and a DOM Node to the DOM. */
  function innerDiffNode(dom, vchildren, context, mountAll) {
  	var originalChildren = dom.childNodes,
  	    children,
  	    keyed,
  	    keyedLen = 0,
  	    min = 0,
  	    len = originalChildren.length,
  	    childrenLen = 0;

  	if (len) {
  		children = [];
  		for (var i = 0; i < len; i++) {
  			var child = originalChildren[i],
  			    key = getKey(child);
  			if (key || key === 0) {
  				if (! keyedLen++) keyed = {};
  				keyed[key] = child;
  			} else {
  				children[childrenLen++] = child;
  			}
  		}
  	}

  	if (vchildren) {
  		for (var i = 0; i < vchildren.length; i++) {
  			var vchild = vchildren[i],
  			    child = undefined;

  			// if (isFunctionalComponent(vchild)) {
  			// 	vchild = buildFunctionalComponent(vchild);
  			// }

  			// attempt to find a node based on key matching
  			if (keyedLen && vchild.attributes) {
  				var key = vchild.key;
  				if (!empty(key) && key in keyed) {
  					child = keyed[key];
  					keyed[key] = undefined;
  					keyedLen--;
  				}
  			}

  			// attempt to pluck a node of the same type from the existing children
  			if (!child && min < childrenLen) {
  				for (var j = min; j < childrenLen; j++) {
  					var _c = children[j];
  					if (_c && isSameNodeType(_c, vchild)) {
  						child = _c;
  						children[j] = undefined;
  						if (j === childrenLen - 1) childrenLen--;
  						if (j === min) min++;
  						break;
  					}
  				}
  			}

  			// morph the matched/found/created DOM child to match vchild (deep)
  			child = diff(child, vchild, context, mountAll);

  			var c = (mountAll || child.parentNode !== dom) && child._component;

  			if (c) deepHook(c, 'componentWillMount');

  			var next = originalChildren[i];
  			if (next !== child) {
  				if (next) {
  					dom.insertBefore(child, next);
  				} else {
  					dom.appendChild(child);
  				}
  			}

  			if (c) deepHook(c, 'componentDidMount');
  		}
  	}

  	if (keyedLen) {
  		/*eslint guard-for-in:0*/
  		for (var i in keyed) {
  			if (keyed[i]) {
  				children[min = childrenLen++] = keyed[i];
  			}
  		}
  	}

  	// remove orphaned children
  	if (min < childrenLen) {
  		removeOrphanedChildren(children);
  	}
  }

  /** Reclaim children that were unreferenced in the desired VTree */

  function removeOrphanedChildren(children, unmountOnly) {
  	for (var i = children.length; i--;) {
  		var child = children[i];
  		if (child) {
  			recollectNodeTree(child, unmountOnly);
  		}
  	}
  }

  /** Reclaim an entire tree of nodes, starting at the root. */

  function recollectNodeTree(node, unmountOnly) {
  	// @TODO: Need to make a call on whether Preact should remove nodes not created by itself.
  	// Currently it *does* remove them. Discussion: https://github.com/developit/preact/issues/39
  	//if (!node[ATTR_KEY]) return;

  	var attrs = node[ATTR_KEY];
  	if (attrs) hook(attrs, 'ref', null);

  	var component = node._component;
  	if (component) {
  		unmountComponent(component, !unmountOnly);
  	} else {
  		if (!unmountOnly) {
  			if (getNodeType(node) !== 1) {
  				removeNode(node);
  				return;
  			}

  			collectNode(node);
  		}

  		var c = node.childNodes;
  		if (c && c.length) {
  			removeOrphanedChildren(c, unmountOnly);
  		}
  	}
  }

  /** Apply differences in attributes from a VNode to the given DOM Node. */
  function diffAttributes(dom, attrs) {
  	var old = dom[ATTR_KEY] || getRawNodeAttributes(dom);

  	// removeAttributes(dom, old, attrs || EMPTY);
  	for (var _name in old) {
  		if (!attrs || !(_name in attrs)) {
  			setAccessor(dom, _name, null, SVG_MODE);
  		}
  	}

  	// new & updated
  	if (attrs) {
  		for (var _name2 in attrs) {
  			if (!(_name2 in old) || attrs[_name2] != (_name2 === 'value' || _name2 === 'selected' || _name2 === 'checked' ? dom[_name2] : old[_name2])) {
  				setAccessor(dom, _name2, attrs[_name2], SVG_MODE);
  			}
  		}
  	}
  }

  var components = {};

  function collectComponent(component) {
  	var name = component.constructor.name,
  	    list = components[name];
  	if (list) list.push(component);else components[name] = [component];
  }

  function createComponent(Ctor, props, context, fresh) {
  	var inst = new Ctor(props, context),
  	    list = !fresh && components[Ctor.name];
  	if (list) {
  		for (var i = 0; i < list.length; i++) {
  			if (list[i].constructor === Ctor) {
  				inst.nextBase = list[i].base;
  				list.splice(i, 1);
  				break;
  			}
  		}
  	}
  	return inst;
  }

  /** Mark component as dirty and queue up a render.
   *	@param {Component} component
   *	@private
   */

  function triggerComponentRender(component) {
  	if (!component._dirty) {
  		component._dirty = true;
  		enqueueRender(component);
  	}
  }

  /** Set a component's `props` (generally derived from JSX attributes).
   *	@param {Object} props
   *	@param {Object} [opts]
   *	@param {boolean} [opts.renderSync=false]	If `true` and {@link options.syncComponentUpdates} is `true`, triggers synchronous rendering.
   *	@param {boolean} [opts.render=true]			If `false`, no render will be triggered.
   */

  function setComponentProps(component, props, opts, context, mountAll) {
  	var d = component._disableRendering === true;
  	component._disableRendering = true;

  	if (component.__ref = props.ref) delete props.ref;
  	if (component.__key = props.key) delete props.key;

  	if (!empty(component.base)) {
  		hook(component, 'componentWillReceiveProps', props, context);
  	}

  	if (context && context !== component.context) {
  		if (!component.prevContext) component.prevContext = component.context;
  		component.context = context;
  	}

  	if (!component.prevProps) component.prevProps = component.props;
  	component.props = props;

  	component._disableRendering = d;

  	if (opts !== NO_RENDER) {
  		if (opts === SYNC_RENDER || options.syncComponentUpdates !== false) {
  			renderComponent(component, SYNC_RENDER, mountAll);
  		} else {
  			triggerComponentRender(component);
  		}
  	}

  	hook(component, '__ref', component);
  }

  /** Render a Component, triggering necessary lifecycle events and taking High-Order Components into account.
   *	@param {Component} component
   *	@param {Object} [opts]
   *	@param {boolean} [opts.build=false]		If `true`, component will build and store a DOM node if not already associated with one.
   *	@private
   */

  function renderComponent(component, opts, mountAll) {
  	if (component._disableRendering) return;

  	var skip,
  	    rendered,
  	    props = component.props,
  	    state = component.state,
  	    context = component.context,
  	    previousProps = component.prevProps || props,
  	    previousState = component.prevState || state,
  	    previousContext = component.prevContext || context,
  	    isUpdate = component.base,
  	    initialBase = isUpdate || component.nextBase,
  	    initialComponent = initialBase && initialBase._component;

  	// if updating
  	if (isUpdate) {
  		component.props = previousProps;
  		component.state = previousState;
  		component.context = previousContext;
  		if (opts !== FORCE_RENDER && hook(component, 'shouldComponentUpdate', props, state, context) === false) {
  			skip = true;
  		} else {
  			hook(component, 'componentWillUpdate', props, state, context);
  		}
  		component.props = props;
  		component.state = state;
  		component.context = context;
  	}

  	component.prevProps = component.prevState = component.prevContext = component.nextBase = null;
  	component._dirty = false;

  	if (!skip) {
  		rendered = hook(component, 'render', props, state, context);

  		// context to pass to the child, can be updated via (grand-)parent component
  		if (component.getChildContext) {
  			context = extend(clone(context), component.getChildContext());
  		}

  		while (isFunctionalComponent(rendered)) {
  			rendered = buildFunctionalComponent(rendered, context);
  		}

  		var childComponent = rendered && rendered.nodeName,
  		    toUnmount,
  		    base;

  		if (isFunction(childComponent) && childComponent.prototype.render) {
  			// set up high order component link

  			var inst = component._component,
  			    childProps = getNodeProps(rendered);

  			if (inst && inst.constructor === childComponent) {
  				setComponentProps(inst, childProps, SYNC_RENDER, context);
  			} else {
  				toUnmount = inst;
  				inst = createComponent(childComponent, childProps, context, false);
  				inst._parentComponent = component;
  				component._component = inst;
  				if (isUpdate) deepHook(inst, 'componentWillMount');
  				setComponentProps(inst, childProps, NO_RENDER, context);
  				renderComponent(inst, SYNC_RENDER);
  				if (isUpdate) deepHook(inst, 'componentDidMount');
  			}

  			base = inst.base;
  		} else {
  			var cbase = initialBase;

  			// destroy high order component link
  			toUnmount = component._component;
  			if (toUnmount) {
  				cbase = component._component = null;
  			}

  			if (initialBase || opts === SYNC_RENDER) {
  				if (cbase) cbase._component = null;
  				base = diff(cbase, rendered || EMPTY_BASE, context, mountAll || !isUpdate, true);
  			}
  		}

  		if (initialBase && base !== initialBase) {
  			var p = initialBase.parentNode;
  			if (p && base !== p) p.replaceChild(base, initialBase);
  			if (!toUnmount && initialComponent === component) {
  				initialBase._component = null;
  				recollectNodeTree(initialBase);
  			}
  		}

  		if (toUnmount) {
  			unmountComponent(toUnmount, true);
  		}

  		component.base = base;
  		if (base) {
  			var componentRef = component,
  			    t = component;
  			while (t = t._parentComponent) {
  				componentRef = t;
  			}
  			base._component = componentRef;
  			base._componentConstructor = componentRef.constructor;
  		}

  		if (isUpdate) {
  			hook(component, 'componentDidUpdate', previousProps, previousState, previousContext);
  		}
  	}

  	var cb = component._renderCallbacks,
  	    fn;
  	if (cb) while (fn = cb.pop()) fn.call(component);

  	return rendered;
  }

  /** Apply the Component referenced by a VNode to the DOM.
   *	@param {Element} dom	The DOM node to mutate
   *	@param {VNode} vnode	A Component-referencing VNode
   *	@returns {Element} dom	The created/mutated element
   *	@private
   */

  function buildComponentFromVNode(dom, vnode, context, mountAll) {
  	var c = dom && dom._component,
  	    oldDom = dom,
  	    isDirectOwner = c && dom._componentConstructor === vnode.nodeName,
  	    isOwner = isDirectOwner;
  	while (c && !isOwner && (c = c._parentComponent)) {
  		isOwner = c.constructor === vnode.nodeName;
  	}

  	if (isOwner && (!mountAll || c._component)) {
  		setComponentProps(c, getNodeProps(vnode), SYNC_RENDER, context, mountAll);
  		dom = c.base;
  	} else {
  		if (c && !isDirectOwner) {
  			unmountComponent(c, true);
  			dom = oldDom = null;
  		}
  		dom = createComponentFromVNode(vnode, dom, context, mountAll);
  		if (oldDom && dom !== oldDom) {
  			oldDom._component = null;
  			recollectNodeTree(oldDom);
  		}
  	}

  	return dom;
  }

  /** Instantiate and render a Component, given a VNode whose nodeName is a constructor.
   *	@param {VNode} vnode
   *	@private
   */
  function createComponentFromVNode(vnode, dom, context, mountAll) {
  	var props = getNodeProps(vnode);
  	var component = createComponent(vnode.nodeName, props, context, !!dom);

  	if (dom) component.nextBase = dom;

  	setComponentProps(component, props, SYNC_RENDER, context, mountAll);

  	return component.base;
  }

  /** Remove a component from the DOM and recycle it.
   *	@param {Element} dom			A DOM node from which to unmount the given Component
   *	@param {Component} component	The Component instance to unmount
   *	@private
   */

  function unmountComponent(component, remove) {
  	// console.log(`${remove?'Removing':'Unmounting'} component: ${component.constructor.name}`, component);

  	hook(component, '__ref', null);
  	hook(component, 'componentWillUnmount');

  	// recursively tear down & recollect high-order component children:
  	var inner = component._component;
  	if (inner) {
  		unmountComponent(inner, remove);
  		remove = false;
  	}

  	var base = component.base;
  	if (base) {
  		if (remove !== false) removeNode(base);
  		removeOrphanedChildren(base.childNodes, true);
  	}

  	if (remove) {
  		component._parentComponent = null;
  		collectComponent(component);
  	}

  	hook(component, 'componentDidUnmount');
  }

  /** Base Component class, for he ES6 Class method of creating Components
   *	@public
   *
   *	@example
   *	class MyFoo extends Component {
   *		render(props, state) {
   *			return <div />;
   *		}
   *	}
   */

  function Component(props, context) {
  	/** @private */
  	this._dirty = true;
  	/** @public */
  	this._disableRendering = false;
  	/** @public */
  	this.prevState = this.prevProps = this.prevContext = this.base = this.nextBase = this._parentComponent = this._component = this.__ref = this.__key = this._linkedStates = this._renderCallbacks = null;
  	/** @public */
  	this.context = context || {};
  	/** @type {object} */
  	this.props = props;
  	/** @type {object} */
  	this.state = hook(this, 'getInitialState') || {};
  }

  extend(Component.prototype, {

  	/** Returns a `boolean` value indicating if the component should re-render when receiving the given `props` and `state`.
    *	@param {object} nextProps
    *	@param {object} nextState
    *	@param {object} nextContext
    *	@returns {Boolean} should the component re-render
    *	@name shouldComponentUpdate
    *	@function
    */
  	// shouldComponentUpdate() {
  	// 	return true;
  	// },

  	/** Returns a function that sets a state property when called.
    *	Calling linkState() repeatedly with the same arguments returns a cached link function.
    *
    *	Provides some built-in special cases:
    *		- Checkboxes and radio buttons link their boolean `checked` value
    *		- Inputs automatically link their `value` property
    *		- Event paths fall back to any associated Component if not found on an element
    *		- If linked value is a function, will invoke it and use the result
    *
    *	@param {string} key				The path to set - can be a dot-notated deep key
    *	@param {string} [eventPath]		If set, attempts to find the new state value at a given dot-notated path within the object passed to the linkedState setter.
    *	@returns {function} linkStateSetter(e)
    *
    *	@example Update a "text" state value when an input changes:
    *		<input onChange={ this.linkState('text') } />
    *
    *	@example Set a deep state value on click
    *		<button onClick={ this.linkState('touch.coords', 'touches.0') }>Tap</button
    */
  	linkState: function linkState(key, eventPath) {
  		var c = this._linkedStates || (this._linkedStates = {}),
  		    cacheKey = key + '|' + eventPath;
  		return c[cacheKey] || (c[cacheKey] = createLinkedState(this, key, eventPath));
  	},

  	/** Update component state by copying properties from `state` to `this.state`.
    *	@param {object} state		A hash of state properties to update with new values
    */
  	setState: function setState(state, callback) {
  		var s = this.state;
  		if (!this.prevState) this.prevState = clone(s);
  		extend(s, isFunction(state) ? state(s, this.props) : state);
  		if (callback) (this._renderCallbacks = this._renderCallbacks || []).push(callback);
  		triggerComponentRender(this);
  	},

  	/** Immediately perform a synchronous re-render of the component.
    *	@private
    */
  	forceUpdate: function forceUpdate() {
  		renderComponent(this, FORCE_RENDER);
  	},

  	/** Accepts `props` and `state`, and returns a new Virtual DOM tree to build.
    *	Virtual DOM is generally constructed via [JSX](http://jasonformat.com/wtf-is-jsx).
    *	@param {object} props		Props (eg: JSX attributes) received from parent element/component
    *	@param {object} state		The component's current state
    *	@param {object} context		Context object (if a parent component has provided context)
    *	@returns VNode
    */
  	render: function render() {
  		return null;
  	}

  });

  /** Render JSX into a `parent` Element.
   *	@param {VNode} vnode		A (JSX) VNode to render
   *	@param {Element} parent		DOM element to render into
   *	@param {Element} [merge]	Attempt to re-use an existing DOM tree rooted at `merge`
   *	@public
   *
   *	@example
   *	// render a div into <body>:
   *	render(<div id="hello">hello!</div>, document.body);
   *
   *	@example
   *	// render a "Thing" component into #foo:
   *	const Thing = ({ name }) => <span>{ name }</span>;
   *	render(<Thing name="one" />, document.querySelector('#foo'));
   */

  function render(vnode, parent, merge) {
    var existing = merge && merge._component && merge._componentConstructor === vnode.nodeName,
        built = diff(merge, vnode, {}, false),
        c = !existing && built._component;

    if (c) deepHook(c, 'componentWillMount');

    if (built.parentNode !== parent) {
      parent.appendChild(built);
    }

    if (c) deepHook(c, 'componentDidMount');

    return built;
  }

  exports.h = h;
  exports.cloneElement = cloneElement;
  exports.Component = Component;
  exports.render = render;
  exports.rerender = rerender;
  exports.options = options;

  Object.defineProperty(exports, '__esModule', { value: true });

}));
//# sourceMappingURL=preact.dev.js.map