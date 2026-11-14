const store = require('./utils/store')

App({
  globalData: {
    sessionId: '',
    displayName: ''
  },
  onLaunch() {
    this.globalData.sessionId = store.getSessionId()
    this.globalData.displayName = store.getDisplayName()
  }
})
