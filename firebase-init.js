var firebaseConfig = {
  apiKey: 'AIzaSyAhnrdf42rryicZD6G59C_twX-u6lLKKjY',
  authDomain: 'pokemon-tcg-simulador.firebaseapp.com',
  projectId: 'pokemon-tcg-simulador',
  storageBucket: 'pokemon-tcg-simulador.firebasestorage.app',
  messagingSenderId: '407859271502',
  appId: '1:407859271502:web:6a28c381b3343c3ea9301f'
};
firebase.initializeApp(firebaseConfig);

// Uncomment to develop against the local Emulator Suite (Task 1) instead
// of the real project -- must match firebase.json's emulator ports:
// firebase.auth().useEmulator('http://127.0.0.1:9099');
// firebase.firestore().useEmulator('127.0.0.1', 8080);
// firebase.functions().useEmulator('127.0.0.1', 5001);
