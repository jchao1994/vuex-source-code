export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  if (version >= 2) { // 2.x及以上使用beforeCreate
    Vue.mixin({ beforeCreate: vuexInit })
  } else { // 1.x改写Vue.prototype._init
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  // 根组件的$store指向传入的store实例，其他组件$store都指向父组件的$store
  // 所有组件的$store都指向传入的store实例
  // 子组件在$mount之后执行这个方法
  function vuexInit () {
    const options = this.$options
    // store injection
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
