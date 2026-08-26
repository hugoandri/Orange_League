(function () {
  // Removes the cold-load spinner (see index.html's own comment) the first
  // time we actually know which screen to show -- called from both branches
  // of onAuthStateChanged below. classList.add('hidden') alone would leave
  // an invisible 9999-z-index fixed-position div sitting over the whole
  // page forever, silently eating every click, so this removes the element
  // outright once it's no longer needed.
  function hideAppLoadingOverlay() {
    var el = document.getElementById('appLoadingOverlay');
    if (el) { el.remove(); }
  }

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
    return 'No se pudo crear la cuenta. Intenta de nuevo.';
  }

  function friendlyProfileSaveError(err) {
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials') {
      return 'La contraseña actual es incorrecta.';
    }
    if (err.code === 'auth/weak-password') {
      return 'La contraseña nueva es muy débil.';
    }
    if (err.code === 'functions/already-exists' || err.code === 'functions/invalid-argument') {
      return err.message;
    }
    return err.message || 'No se pudo guardar el perfil.';
  }

  // Reads an image file, downscales it to at most maxSize px on its longest
  // side, and re-encodes as JPEG -- keeps the resulting data URL well under
  // updateProfile's server-side size cap without needing Firebase Storage.
  function compressImageFile(file, maxSize, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
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
      var email = document.getElementById('authLoginEmail').value.trim();
      var password = document.getElementById('authLoginPassword').value;
      setSubmitting('authLoginSubmit', true, 'Entrar');
      firebase.auth().signInWithEmailAndPassword(email, password)
        .catch(function () {
          setError('authLoginError', 'Email o contraseña incorrectos.');
        })
        .then(function () {
          setSubmitting('authLoginSubmit', false, 'Entrar');
        });
    });

    document.getElementById('authSignupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      setError('authSignupError', '');
      var username = document.getElementById('authSignupUsername').value.trim();
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
      var email = document.getElementById('authForgotEmail').value.trim();
      setSubmitting('authForgotSubmit', true, 'Enviar mail de recuperación');
      firebase.auth().sendPasswordResetEmail(email)
        .catch(function () { /* deliberately silent -- same message either way, see below */ })
        .then(function () {
          document.getElementById('authForgotMessage').textContent =
            'Si el email existe, te llegará un mail con instrucciones.';
          setSubmitting('authForgotSubmit', false, 'Enviar mail de recuperación');
        });
    });

    document.getElementById('menuLogoutBtn').addEventListener('click', function () {
      firebase.auth().signOut();
    });

    // ── Profile widget + edit modal ──────────────────────────────────
    var pendingPhoto = null;

    document.getElementById('menuProfileBtn').addEventListener('click', function () {
      document.getElementById('editProfileError').textContent = '';
      pendingPhoto = null;
      document.getElementById('editProfilePreviewImg').src = playerPhotoUrl();
      document.getElementById('editProfileUsername').value = (profileState && profileState.username) || '';
      document.getElementById('editProfilePhotoInput').value = '';
      document.getElementById('editProfileCurrentPassword').value = '';
      document.getElementById('editProfileNewPassword').value = '';
      document.getElementById('editProfileModal').classList.remove('hidden');
    });

    document.getElementById('editProfileCancel').addEventListener('click', function () {
      document.getElementById('editProfileModal').classList.add('hidden');
    });
    document.getElementById('editProfileCloseX').addEventListener('click', function () {
      document.getElementById('editProfileModal').classList.add('hidden');
    });
    document.querySelector('#editProfileModal .card-modal-backdrop').addEventListener('click', function () {
      document.getElementById('editProfileModal').classList.add('hidden');
    });

    document.getElementById('editProfilePhotoInput').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) { return; }
      compressImageFile(file, 200, 0.8).then(function (dataUrl) {
        pendingPhoto = dataUrl;
        document.getElementById('editProfilePreviewImg').src = dataUrl;
      });
    });

    document.getElementById('editProfileSave').addEventListener('click', function () {
      var errorEl = document.getElementById('editProfileError');
      errorEl.textContent = '';

      var newUsername = document.getElementById('editProfileUsername').value.trim();
      var currentUsername = (profileState && profileState.username) || '';
      var currentPassword = document.getElementById('editProfileCurrentPassword').value;
      var newPassword = document.getElementById('editProfileNewPassword').value;

      var profilePayload = {};
      if (newUsername && newUsername !== currentUsername) { profilePayload.username = newUsername; }
      if (pendingPhoto) { profilePayload.photo = pendingPhoto; }
      var hasProfileChanges = !!(profilePayload.username || profilePayload.photo);

      if (newPassword && newPassword.length < 6) {
        errorEl.textContent = 'La contraseña nueva debe tener al menos 6 caracteres.';
        return;
      }
      if (newPassword && !currentPassword) {
        errorEl.textContent = 'Ingresa tu contraseña actual para cambiarla.';
        return;
      }
      if (!hasProfileChanges && !newPassword) {
        document.getElementById('editProfileModal').classList.add('hidden');
        return;
      }

      var btn = document.getElementById('editProfileSave');
      btn.disabled = true;

      var chain = Promise.resolve();
      if (newPassword) {
        var user = firebase.auth().currentUser;
        var credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
        chain = chain
          .then(function () { return user.reauthenticateWithCredential(credential); })
          .then(function () { return user.updatePassword(newPassword); });
      }
      if (hasProfileChanges) {
        chain = chain.then(function () { return updateProfileCloud(profilePayload); });
      }

      chain
        .then(function () {
          btn.disabled = false;
          document.getElementById('editProfileCurrentPassword').value = '';
          document.getElementById('editProfileNewPassword').value = '';
          document.getElementById('editProfileModal').classList.add('hidden');
        })
        .catch(function (err) {
          btn.disabled = false;
          errorEl.textContent = friendlyProfileSaveError(err);
        });
    });

    // Safety net: if Firebase never calls back at all (e.g. it fails to
    // load/init on a bad connection), don't leave the spinner covering the
    // page forever -- fall back to whatever's already in the DOM (the raw
    // authScreen, unhidden by default) so there's at least a login form
    // and a chance to retry, instead of a dead end.
    setTimeout(hideAppLoadingOverlay, 15000);

    var unsubscribeEconomy = null;
    firebase.auth().onAuthStateChanged(function (user) {
      hideAppLoadingOverlay();
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
