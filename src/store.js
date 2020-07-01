import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      // 挂载在window上的自动安装，也就是通过script标签引入时不需要手动调用Vue.use(Vuex)
      install(window.Vue)
    }

    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`) // 必须支持Promise
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    const {
      plugins = [], // 插件
      strict = false // 严格模式
    } = options

    // store internal state
    // _committing提交状态的标志，在_withCommit中，当使用mutation时，会先赋值为true，再执行mutation，修改state后再赋值为false，
    // 在这个过程中，会用watch监听state的变化时是否_committing为true，从而保证只能通过mutation来修改state
    this._committing = false
    // _actions用于保存所有action
    this._actions = Object.create(null)
    // _actionSubscribers用于保存订阅action的回调
    this._actionSubscribers = []
    // _mutations用于保存所有的mutation
    this._mutations = Object.create(null)
    // _wrappedGetters用于保存包装后的getter
    this._wrappedGetters = Object.create(null)
    // _modules用于保存一棵module树  this._modules.root指向这个module树的根module
    this._modules = new ModuleCollection(options)
    // _modulesNamespaceMap用于保存namespaced的模块
    this._modulesNamespaceMap = Object.create(null)
    // 用于监听mutation
    this._subscribers = []
    // 用于响应式地监测一个getter方法的返回值
    this._watcherVM = new Vue()
    this._makeLocalGettersCache = Object.create(null)

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    // 把dispatch和commit的this绑定为store实例，无法修改this指向
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode // 严格模式
    this.strict = strict

    const state = this._modules.root.state // 根module的state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    // 这里是module处理的核心，包括处理根module、action、mutation、getters和递归注册子module
    // store的核心代码
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    // 使用vue实例来保存state和getters
    resetStoreVM(this, state)

    // apply plugins
    // 注册插件，所有插件都是一个函数，接受store作为参数
    plugins.forEach(plugin => plugin(this))

    // Vuex中内置了devtool和logger两个插件
    // 如果开启devtools，注册devtool
    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      devtoolPlugin(this)
    }
  }

  get state () {
    return this._vm._data.$$state
  }

  set state (v) {
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  commit (_type, _payload, _options) {
    // 这里的this已经绑定为store了
    // check object-style commit
    // 统一格式，因为支持对象风格和payload风格
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    // 获取当前type对应保存下来的mutations数组
    const entry = this._mutations[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    // 包裹在_withCommit中执行mutation，mutation是修改state的唯一方法
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    // 执行mutation的订阅者
    this._subscribers
      .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
      .forEach(sub => sub(mutation, this.state))

    if (
      process.env.NODE_ENV !== 'production' &&
      options && options.silent
    ) {
      // 提示silent参数已经移除
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  dispatch (_type, _payload) {
    // this已经绑定为store
    // check object-style dispatch
    // 统一格式，因为支持对象风格和payload风格
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    // 获取actions数组
    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    try {
      // 执行action的before订阅者
      this._actionSubscribers
        .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    const result = entry.length > 1
      // 如果action数量大于1，需要用Promise.all包裹
      ? Promise.all(entry.map(handler => handler(payload)))
      // 如果action数量为1，直接调用，本身返回的就是一个Promise
      : entry[0](payload)

    return result.then(res => {
      try {
        // 执行action的after订阅者
        this._actionSubscribers
          .filter(sub => sub.after)
          .forEach(sub => sub.after(action, this.state))
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[vuex] error in after action subscribers: `)
          console.error(e)
        }
      }
      return res
    })
  }

  subscribe (fn) {
    return genericSubscribe(fn, this._subscribers)
  }

  subscribeAction (fn) {
    // 传入function，就默认定义为before
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers)
  }

  watch (getter, cb, options) { // 新的vue实例 $watch监控getter(this.state, this.getters)的返回值，调用此方法的返回值可以停止监控
    if (process.env.NODE_ENV !== 'production') {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  replaceState (state) { // 修改state，主要用于devtool插件的时空穿梭功能
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  registerModule (path, rawModule, options = {}) { // 动态注册module
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`) // path必须为string或者Array
      assert(path.length > 0, 'cannot register the root module by using registerModule.') // 不能注册根module，也就是path不能为空数组
    }

    this._modules.register(path, rawModule) // 注册到module树上
    installModule(this, this.state, path, this._modules.get(path), options.preserveState) // module安装，如果options.preserveState为true，就不设置state
    // reset store to update getters...
    // 更新store._vm  用来保存state和getters
    resetStoreVM(this, this.state)
  }

  // 如果注销原来module树上的module，不会从原module上移除该module，但是parent.State会移除该state，最终会如何？？？
  unregisterModule (path) { // 注销module，只能注销动态注册的module
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path) // 在parent._children上移除module，只能移除动态注册的module
    this._withCommit(() => { // 用Vue.delete在parentState上移除这个module的state，通知parentState的依赖更新
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this) // 重置store
  }

  // ???
  hotUpdate (newOptions) {
    this._modules.update(newOptions) // 以newOptions作为新的根module，递归更新整个module树上的所有module的namespaced actions mutations getters
    resetStore(this, true) // 注册整个module树，但不会重新设置state，设置vm实例来保存state和getters
  }

  // 在执行mutation的时候，会将_committing设置为true，执行完毕后重置，在开启strict模式时，会监听state的变化，当变化时_committing不为true时会给出警告
  _withCommit (fn) { 
    const committing = this._committing // false
    this._committing = true
    fn()
    this._committing = committing // false
  }
}

function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) { // subs中没有fn就push
    subs.push(fn)
  }
  return () => { // 执行就从subs中移除fn
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

// 将_actions _mutations _wrappedGetters _modulesNamespaceMap都清空
// 重新注册module，installModule传入的hot为true，导致不再给state设置响应式，不需要重新设置响应式
// 注册mutation action getters 递归注册子module
// 使用vue实例来保存state和getters
function resetStore (store, hot) { // hot为undefined
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true) // 传入hot为true，则不会重新设置state
  // reset vm
  resetStoreVM(store, state, hot) // hot为undefined，则不会将oldVm._data.$$state设为null
}

// 使用vue实例来保存state和getters
// store._vm.$$state指向state
// store._vm用computed计算属性保存getters
function resetStoreVM (store, state, hot) { // store实例 根state
  // 保存旧vm
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  // reset local getters cache
  // store._makeLocalGettersCache是根据namespace存储的各个module的getters的对象
  store._makeLocalGettersCache = Object.create(null)
  // store._wrappedGetters是全部的getters
  const wrappedGetters = store._wrappedGetters // 注册好的getters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure environment.
    // getter保存在computed中
    computed[key] = partial(fn, store) // 对应的是getter(state, getters, rootState, rootGetters)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key], // store.getters[key]取的是store._vm上的computed，也就是上面存储getters的computed
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  // 使用一个vue实例来保存state和getter
  // silent设置为true，取消所有日志警告等
  const silent = Vue.config.silent
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      $$state: state // 根state，将state设置为响应式
    },
    computed // 将getters设置为计算属性，有缓存和响应式功能
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  // 用$watch监听state，不允许在mutation之外修改state
  if (store.strict) {
    enableStrictMode(store)
  }

  // 如果有oldVm，解除对state的引用，等dom更新后把旧的vue实例销毁
  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

// 注册module
// 将parentState[moduleName]设为state，同时设置响应式
// 注册mutation action getters 递归注册子module
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length // 是否为根module
  /*
   * {
   *   // ...
   *   modules: {
   *     moduleA: {
   *       namespaced: true,
   *       modules: {
   *         moduleC: {
   *           namespaced: true
   *         }
   *       }
   *     },
   *     moduleB: {}
   *   }
   * }
   * moduleA的namespace -> 'moduleA/'
   * moduleB的namespace -> ''
   * moduleC的namespace -> 'moduleA/moduleC'
   */
  const namespace = store._modules.getNamespace(path) // 根据path获取namespace

  // register in namespace map
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') { // namespace重复
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module // 在this._modulesNamespaceMap中注册namespaced为true的module
  }

  // set state
  // 将各级state注册在state树上
  if (!isRoot && !hot) { // 如果不是根module且不是hot，设置state
    const parentState = getNestedState(rootState, path.slice(0, -1)) // 取父state
    const moduleName = path[path.length - 1] // 当前module的moduleName
    store._withCommit(() => {
      if (process.env.NODE_ENV !== 'production') {
        if (moduleName in parentState) { // parentState中不能有moduleName这个key
          console.warn(
            `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
          )
        }
      }
      // 将parentState[moduleName]设为state，同时设置响应式
      Vue.set(parentState, moduleName, module.state)
    })
  }

  // 设置module的上下文，从而保证mutation和action的第一个参数能拿到对应的state getter等
  // 返回的local是一个包含 处理过的 dispatch commit getters state 的对象
  // action mutation getter存储是带namespace的，这里做了代理，传入的type是不带namespace的
  const local = module.context = makeLocalContext(store, namespace, path)

  // 统一注册mutation到this._mutations上
  // 存储的type带namespace，允许同名，数组存储
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key // moduleA/key
    registerMutation(store, namespacedType, mutation, local)
  })

  // 统一注册action
  // 存储的type带namespace，允许同名，数组存储
  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  // 统一注册getter，不允许重复定义
  // 存储的type带namespace，不允许同名
  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 递归注册子module
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
// namespace 当前module的namespace
// path 当前module的path
function makeLocalContext (store, namespace, path) { // dispatch commit getters state
  const noNamespace = namespace === ''

  const local = {
    // 如果没有namespace，直接使用原来的
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      // 统一格式  支持payload风格和对象风格
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      // root为true，也就是根的action，且有options，type不会加namespace
      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    // 如果没有namespace，直接使用原来的
    // commit(type)传入的type不带namespace，但最后执行store.commit(type)中的type是已经拼接namespace后的
    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      // 统一格式  支持payload风格和对象风格
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      // root为true，也就是根的action，且有options，type不会加namespace
      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  // 这里的getters和state需要延迟处理，需要等数据更新后才进行计算，所以使用getter函数，当访问的时候再进行计算
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        // 给getters加一层代理 这样在module中获取到的getters不会带命名空间，实际返回的是store.getters[type] type是有命名空间的
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

function makeLocalGetters (store, namespace) {
  if (!store._makeLocalGettersCache[namespace]) { // 是否有缓存
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      // skip if the target getter is not match this namespace
      // 如果这个getter和namespace不匹配，直接return
      if (type.slice(0, splitPos) !== namespace) return

      // extract local getter type
      // type去掉namespace后得到最初的type
      const localType = type.slice(splitPos)

      // Add a port to the getters proxy.
      // Define as getter property because
      // we do not want to evaluate the getters in this time.
      // 给getters加一层代理 这样在module中获取到的getters不会带命名空间，实际返回的是store.getters[type] type是有命名空间的
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }

  return store._makeLocalGettersCache[namespace]
}

function registerMutation (store, type, handler, local) { // 注册mutation到this._mutations上，绑定this为store实例  type带namespace
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) { // commit的时候只需要传入payload
    handler.call(store, local.state, payload) // mutation可以接受两个参数，第一个是state，第二个就是commit传入的payload
  })
}

function registerAction (store, type, handler, local) { // 注册action到this._actions上，绑定this为store实例  type带namespace
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) { // dispatch的时候只需要传入payload
    let res = handler.call(store, { // action可以接受两个参数，第一个是对象，可以获取dispatch commit getters state rootGetters rootState，第二个就是dispatch传入的payload
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    // 如果action的执行结果不是promise，将他包裹为promise，这样就支持promise的链式调用
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      // 使用devtool处理一次error？？？
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

function registerGetter (store, type, rawGetter, local) {
  // 不允许重复定义getters
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    // 执行时传入store，执行对应的getter函数
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

function enableStrictMode (store) {
  // 监听this._data.$$state(也就是state)，不允许在mutation之外修改state
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

function getNestedState (state, path) { // 取path对应的state
  return path.reduce((state, key) => state[key], state)
}

function unifyObjectStyle (type, payload, options) { // 统一格式
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

export function install (_Vue) {
  if (Vue && _Vue === Vue) { // 重复注册，报警
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
