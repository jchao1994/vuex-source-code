import Module from './module'
import { assert, forEachValue } from '../util'

export default class ModuleCollection {
  constructor (rawRootModule) { // rawRootModule是new Vuex.Store(options)传入的options
    // register root module (Vuex.Store options)
    // 生成整个module树
    this.register([], rawRootModule, false)
  }

  get (path) { // 根据path获取module
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  getNamespace (path) { // 根据path获取namespace
    let module = this.root // 根module
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  register (path, rawModule, runtime = true) { // rawModule是new Vuex.Store(options)传入的options
    if (process.env.NODE_ENV !== 'production') { // 断言rawModule中的getters、actions、mutations必须为指定的类型
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime)
    if (path.length === 0) { // path为[]，表示是根module
      this.root = newModule
    } else { // 子module  添加到父module的_children属性上
      const parent = this.get(path.slice(0, -1)) // 父module
      parent.addChild(path[path.length - 1], newModule) // 在父module的_children中添加子module
    }

    // register nested modules
    // 如果当前模块存在子模块（modules字段）
    // 遍历子模块，逐个注册，最终形成一个树
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  unregister (path) { // 在parent._children中移除module
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    // store.registerModule动态注册的module的runtime为true
    // new store(options)执行构造函数生成this._modules时创建的module树的每个module的runtime都为false
    // 这里只能移除动态注册的module
    if (!parent.getChild(key).runtime) return // module的runtime为false，直接返回

    parent.removeChild(key)
  }
}

function update (path, targetModule, newModule) { // 根路径 根module 新的module
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, newModule)
  }

  // update target module // 将targetModule的namespaced actions mutations getters更新为newModule的
  targetModule.update(newModule)

  // update nested modules // 递归更新子module的namespaced actions mutations getters，这里不能进行添加操作，只能替换
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) { // 老的targetModule必须要key，不能添加
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}

function assertRawModule (path, rawModule) { // 断言rawModule中的getters、actions、mutations必须为指定的类型
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key]

    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
