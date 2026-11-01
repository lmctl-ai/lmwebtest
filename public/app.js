function showCreateForm(type) {
  document.getElementById('create-form').style.display = 'block';
  document.getElementById('create-type').value = type;
  document.getElementById('content-field').style.display = type === 'file' ? 'block' : 'none';
  document.getElementById('create-name').value = '';
  document.getElementById('create-content').value = '';
  document.getElementById('create-name').focus();
}

function hideCreateForm() {
  document.getElementById('create-form').style.display = 'none';
}

function showMoveForm(name) {
  document.getElementById('move-dialog').style.display = 'block';
  document.getElementById('move-current-name').value = name;
  document.getElementById('move-new-name').value = name;
  var form = document.getElementById('move-form');
  form.setAttribute('hx-post', '/api/files/' + encodeURIComponent(name) + '/move');
  htmx.process(form);
  document.getElementById('move-new-name').focus();
}

function hideMoveDialog() {
  document.getElementById('move-dialog').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('add-file-btn').addEventListener('click', function () {
    showCreateForm('file');
  });
  document.getElementById('add-folder-btn').addEventListener('click', function () {
    showCreateForm('folder');
  });
  document.querySelector('#new-item-form button[type="button"]').addEventListener('click', hideCreateForm);
  document.querySelector('#move-form button[type="button"]').addEventListener('click', hideMoveDialog);
});

document.addEventListener('click', function (event) {
  var moveButton = event.target.closest('.move-btn');
  if (moveButton) {
    showMoveForm(moveButton.getAttribute('data-move-name') || '');
    return;
  }

  if (event.target.closest('.cancel-edit-btn')) {
    document.getElementById('editor-panel').innerHTML = '';
  }
});

document.body.addEventListener('htmx:afterRequest', function (event) {
  if (!event.detail.successful) {
    return;
  }

  var elt = event.detail.elt;
  if (!elt || !elt.id) {
    return;
  }

  if (elt.id === 'new-item-form') {
    hideCreateForm();
    return;
  }

  if (elt.id === 'move-form') {
    hideMoveDialog();
    return;
  }

  if (elt.id === 'edit-form') {
    document.getElementById('editor-panel').innerHTML = '';
  }
});
