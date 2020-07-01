const target = typeof window !== 'undefined'
  ? window
  : typeof global !== 'undefined'
    ? global
    : {}
const devtoolHook = target.__VUE_DEVTOOLS_GLOBAL_HOOK__

export default function devtoolPlugin (store) {
  if (!devtoolHook) return

  store._devtoolHook = devtoolHook

  // 下面这些emit和on的事件对应的on和emit在哪里？？？
  // 触发vuex:init
  devtoolHook.emit('vuex:init', store)

  // 时空穿梭功能
  devtoolHook.on('vuex:travel-to-state', targetState => {
    store.replaceState(targetState) // 修改store._vm._data.$$state
  })

  // 订阅mutation，当触发mutation（也就是执行commit）时触发vuex:mutation方法，传入mutation和state
  store.subscribe((mutation, state) => { // store._subscribers中push传入的函数fn
    devtoolHook.emit('vuex:mutation', mutation, state)
  })
}
