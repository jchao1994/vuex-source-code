import { forEachValue } from '../util'

// Base data struct for store's module, package with some attribute and method
export default class Module {
  constructor (rawModule, runtime) { // rawModule是new Vuex.Store(options)传入的options
    // 初始化时runtime为false
    this.runtime = runtime
    // Store some children item
    // 用于保存子模块
    this._children = Object.create(null)
    // Store the origin module object which passed by programmer
    // this._rawModule存储new Vuex.Store(options)传入的options
    this._rawModule = rawModule
    const rawState = rawModule.state

    // Store the origin module's state
    // 保存用户传入的state(统一处理为对象形式)
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }

  get namespaced () { // namespaced只要不为''，就是true
    return !!this._rawModule.namespaced
  }

  addChild (key, module) { // 添加子模块到this._children中
    this._children[key] = module
  }

  removeChild (key) { // 从this._children中移除子模块
    delete this._children[key]
  }

  getChild (key) { // 获取子模块
    return this._children[key]
  }

  update (rawModule) { // 更新this._rawModule.namespaced/actions/mutations/getters
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  forEachChild (fn) { // _children中的每一项执行fn(module, key)
    forEachValue(this._children, fn)
  }

  forEachGetter (fn) { // this._rawModule.getters中的每一个getter执行fn(getter, key)
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  forEachAction (fn) { // this._rawModule.actions中的每一个action执行fn(action, key)
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  forEachMutation (fn) { // this._rawModule.mutations中的每一个mutation执行fn(mutation, key)
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
