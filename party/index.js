export default class Server {
  constructor(room) {
    this.room = room;
  }

  onConnect(connection) {
    connection.send(JSON.stringify({ type: 'echo-ready' }));
  }

  onMessage(message, sender) {
    sender.send(message);
  }
}
