export default class LocalMockGameConnection {
  constructor(handlers, mockGame) {
    this.h = handlers;
    this.mockGame = mockGame;
    this.localStream = typeof MediaStream === "function" ? new MediaStream() : null;
    this.videoDeviceId = "";
    this.audioDeviceId = "";
  }

  async initMedia() {
    return this.localStream;
  }

  async listDevices() {
    return { cameras: [], mics: [] };
  }

  async join() {
    this.h.onRoster?.(this.mockGame.roster || []);
    return this.mockGame.localId;
  }

  close() {}
  setMembershipStates() {}
  setAllowedMemberships() {}
  rotateRealtimeEpoch() { return Promise.resolve(); }
  requestRemoteCapture() { return Promise.reject(new Error("Remote capture is unavailable in a local mock game.")); }
  requestMembershipRefresh() {}
  requestVideoQuality() {}
  toggleTrack() {}
  switchDevice() { return Promise.resolve(); }
  setLife() {}
  setLobbyName() {}
  setCommander() {}
  setCommanderPartner() {}
  setColor() {}
  setMuted() {}
  setCameraEnabled() {}
  setActivePlayer() {}
  setGridOrder() {}
  setPoison() {}
  setCommanderDamage() {}
  setElimination() {}
  announceCard() {}
  sendChat() {}
  sendWhisper() {}
  sendDiceRoll() {}
  startReadyCheck() {}
  respondReady() {}
  endReadyCheck() {}
  setVideoCounter() {}
  removeVideoCounter() {}
}
