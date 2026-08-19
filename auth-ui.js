(function () {
  function showPanel(id) {
    ['authLoginForm', 'authSignupForm', 'authForgotForm'].forEach(function (pid) {
      document.getElementById(pid).classList.toggle('hidden', pid !== id);
    });
  }

  function setError(id, message) {
    document.getElementById(id).textContent = message || '';
  }

  function setSubmitting(btnId, isSubmitting, label) {
    var btn = document.getElementById(btnId);
    btn.disabled = isSubmitting;
    btn.textContent = isSubmitting ? 'Un momento…' : label;
  }

  function friendlyCreateAccountError(err) {
    if (err.code === 'functions/already-exists' || err.code === 'functions/invalid-argument') {
      return err.message;
    }
    return 'No se pudo crear la cuenta. Intentá de nuevo.';
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('authShowSignup').addEventListener('click', function (e) {
      e.preventDefault();
      showPanel('authSignupForm');
    });
    document.getElementById('authShowForgot').addEventListener('click', function (e) {
      e.preventDefault();
      showPanel('authForgotForm');
    });
    document.getElementById('authShowLoginFromSignup').addEventListener('click', function (e) {
      e.preventDefault();
      showPanel('authLoginForm');
    });
    document.getElementById('authShowLoginFromForgot').addEventListener('click', function (e) {
      e.preventDefault();
      showPanel('authLoginForm');
    });

    document.getElementById('authLoginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      setError('authLoginError', '');
      var username = document.getElementById('authLoginUsername').value.trim().toLowerCase();
      var password = document.getElementById('authLoginPassword').value;
      setSubmitting('authLoginSubmit', true, 'Entrar');
      firebase.functions().httpsCallable('resolveLoginEmail')({ username: username })
        .then(function (res) {
          return firebase.auth().signInWithEmailAndPassword(res.data.email, password);
        })
        .catch(function () {
          setError('authLoginError', 'Usuario o contraseña incorrectos.');
        })
        .then(function () {
          setSubmitting('authLoginSubmit', false, 'Entrar');
        });
    });

    document.getElementById('authSignupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      setError('authSignupError', '');
      var username = document.getElementById('authSignupUsername').value.trim().toLowerCase();
      var email = document.getElementById('authSignupEmail').value.trim();
      var password = document.getElementById('authSignupPassword').value;
      setSubmitting('authSignupSubmit', true, 'Crear cuenta');
      firebase.functions().httpsCallable('createAccount')({ username: username, email: email, password: password })
        .then(function () {
          return firebase.auth().signInWithEmailAndPassword(email, password);
        })
        .catch(function (err) {
          setError('authSignupError', friendlyCreateAccountError(err));
        })
        .then(function () {
          setSubmitting('authSignupSubmit', false, 'Crear cuenta');
        });
    });

    document.getElementById('authForgotForm').addEventListener('submit', function (e) {
      e.preventDefault();
      setError('authForgotError', '');
      document.getElementById('authForgotMessage').textContent = '';
      var username = document.getElementById('authForgotUsername').value.trim().toLowerCase();
      setSubmitting('authForgotSubmit', true, 'Enviar mail de recuperación');
      firebase.functions().httpsCallable('resolveLoginEmail')({ username: username })
        .then(function (res) { return firebase.auth().sendPasswordResetEmail(res.data.email); })
        .catch(function () { /* deliberately silent -- same message either way, see below */ })
        .then(function () {
          document.getElementById('authForgotMessage').textContent =
            'Si el usuario existe, te llegará un mail con instrucciones.';
          setSubmitting('authForgotSubmit', false, 'Enviar mail de recuperación');
        });
    });

    document.getElementById('menuLogoutBtn').addEventListener('click', function () {
      firebase.auth().signOut();
    });

    var unsubscribeEconomy = null;
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('menuScreen').classList.remove('hidden');
        if (unsubscribeEconomy) { unsubscribeEconomy(); }
        unsubscribeEconomy = initEconomyListener(user.uid);
      } else {
        if (unsubscribeEconomy) {
          unsubscribeEconomy();
          unsubscribeEconomy = null;
        }
        document.getElementById('menuScreen').classList.add('hidden');
        document.getElementById('authScreen').classList.remove('hidden');
        showPanel('authLoginForm');
        document.getElementById('authLoginForm').reset();
        document.getElementById('authSignupForm').reset();
        document.getElementById('authForgotForm').reset();
      }
    });
  });
})();
