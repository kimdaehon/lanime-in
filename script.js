document.addEventListener('DOMContentLoaded', () => {
      const $ = (s) => document.querySelector(s);
      const $$ = (s) => document.querySelectorAll(s);

      const SUPABASE_URL = 'https://pjmzoprbvfsteshvcmin.supabase.co';
      const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqbXpvcHJidmZzdGVzaHZjbWluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3Mzk3NzcsImV4cCI6MjA5MTMxNTc3N30.m6TzEE0gyu3JwfFv92TgShl3dkNaaOfKi-g5DDB9h9I';
      
      const VAPID_PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhrKL2GBj/ThrJos8Vyr+0QhihTmzmbC5gexoXmGhUhJ430znbEmrj9gcKsLdqbz+0+4k5WsWd6bpU+b14YORng==';

      const { createClient } = window.supabase;
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      // --- FUNGSI DEBUG CONSOLE ---
      function showDebugMessage(message) {
        try {
          let debugConsole = document.getElementById('debug-console');
          if (!debugConsole) {
            debugConsole = document.createElement('div');
            debugConsole.id = 'debug-console';
            document.body.appendChild(debugConsole);
          }
          const errorEntry = document.createElement('pre');
          
          let errorMessage = (typeof message === 'object' && message !== null) 
                             ? message.stack || JSON.stringify(message) 
                             : String(message);
          
          errorEntry.textContent = `[${new Date().toLocaleTimeString()}] ${errorMessage}`;
          debugConsole.appendChild(errorEntry);
          debugConsole.scrollTop = debugConsole.scrollHeight;
        } catch(e) {
          console.error('Debug console failure:', e);
        }
      }
      
      // Menangkap semua error global
      window.onerror = function(message, source, lineno, colno, error) {
        showDebugMessage(`GLOBAL ERROR:\n${message}\nDi: ${source} (Line: ${lineno})\nError: ${error?.stack || error}`);
        return true; 
      };
      // ----------------------------

      const createStorageManager = (key) => ({ get: () => JSON.parse(localStorage.getItem(key)) || [], save: (data) => localStorage.setItem(key, JSON.stringify(data)), });
      const WishlistManager = { ...createStorageManager('luminox_wishlist'), add: (postId) => { const wishlist = WishlistManager.get(); if (!wishlist.includes(postId)) { wishlist.push(postId); WishlistManager.save(wishlist); } }, remove: (postId) => { let wishlist = WishlistManager.get(); wishlist = wishlist.filter(id => id !== postId); WishlistManager.save(wishlist); }, has: (postId) => WishlistManager.get().includes(postId) };
      const HistoryManager = { ...createStorageManager('luminox_history'), add: (postId) => { let history = HistoryManager.get(); history = history.filter(id => id !== postId); history.unshift(postId); if (history.length > 50) history.pop(); HistoryManager.save(history); } };
      let state = { posts: [], currentCategory: '', searchQuery: '', isLoading: true, user: null, profile: null, activeChatChannel: null, activeCommentChannel: null, activePostsChannel: null, pushSubscription: null };

      function showNotification(message, type = 'success', duration = 4000) {
          const container = $('#notification-container');
          const toast = document.createElement('div');
          toast.className = `toast ${type}`;
          const icons = { success: 'fa-check-circle', error: 'fa-times-circle' };
          toast.innerHTML = `<i class="fas ${icons[type]}"></i><span>${message}</span>`;
          container.appendChild(toast);
          setTimeout(() => toast.classList.add('show'), 10);
          setTimeout(() => {
              toast.classList.remove('show');
              toast.classList.add('hide');
              toast.addEventListener('transitionend', () => toast.remove());
          }, duration);
      }

      const authModalWrapper = $('#auth-modal-wrapper');
      const authContainer = $('#auth-container');
      const openAuthModal = () => authModalWrapper.classList.add('open');
      const closeAuthModal = () => authModalWrapper.classList.remove('open');
      
      const requestModalWrapper = $('#request-modal-wrapper');
      const requestContainer = $('#request-container');
      const openRequestModal = () => requestModalWrapper.classList.add('open');
      const closeRequestModal = () => requestModalWrapper.classList.remove('open');

      $('#auth-modal-close').addEventListener('click', closeAuthModal);
      $('#auth-modal-backdrop').addEventListener('click', closeAuthModal);
      $('#request-modal-close').addEventListener('click', closeRequestModal);
      $('#request-modal-backdrop').addEventListener('click', closeRequestModal);

      // --- FUNGSI PUSH NOTIFICATION ---
      function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
      }

      async function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) {
          showNotification('Browser Anda tidak mendukung notifikasi.', 'error');
          return null;
        }
        try {
          const registration = await navigator.serviceWorker.register('/service-worker.js', {
            scope: '/'
          });
          console.log('Service Worker terdaftar:', registration);
          
          if (registration.active) {
            await checkSubscriptionStatus();
          } else {
            registration.addEventListener('statechange', (e) => {
              if (e.target.state === 'activated') {
                checkSubscriptionStatus();
              }
            });
          }
          
          return registration;
        } catch (error) {
          console.error('Gagal mendaftarkan Service Worker:', error);
          showNotification('Gagal mendaftarkan Service Worker.', 'error');
          return null;
        }
      }

      async function askNotificationPermission() {
        if (!('Notification' in window)) {
          showNotification('Browser Anda tidak mendukung notifikasi.', 'error');
          return;
        }
        
        const permission = await Notification.requestPermission();
        
        if (permission === 'granted') {
          console.log('Izin notifikasi diberikan.');
          await subscribeUserToPush();
        } else {
          console.log('Izin notifikasi ditolak.');
          showNotification('Anda menolak izin notifikasi.', 'error');
        }
      }

      async function subscribeUserToPush() {
        const registration = await navigator.serviceWorker.ready;
        if (!registration) {
          showNotification('Service Worker tidak siap.', 'error');
          return;
        }

        if (VAPID_PUBLIC_KEY === 'MASUKKAN_VAPID_PUBLIC_KEY_ANDA_DI_SINI') {
            console.error('VAPID_PUBLIC_KEY belum diatur!');
            showNotification('Konfigurasi notifikasi di sisi admin belum selesai.', 'error');
            return;
        }

        try {
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
          
          console.log('Berhasil subscribe:', subscription);
          state.pushSubscription = subscription;
          
          const isSaved = await saveSubscriptionToSupabase(subscription);
          
          if (isSaved) {
            $('#notifications-toggle').classList.add('subscribed');
          }

        } catch (error) {
          console.error('Gagal subscribe:', error);
          showNotification('Gagal berlangganan notifikasi.', 'error');
        }
      }

      async function saveSubscriptionToSupabase(subscription) {
        const subData = {
          subscription_data: subscription.toJSON(),
          user_id: state.user ? state.user.id : null,
          role: state.profile ? state.profile.role : null
        };

        let query;
        if (state.user) {
          query = supabase
            .from('push_subscriptions')
            .upsert(subData, { onConflict: 'user_id' }); 
        } else {
          query = supabase
            .from('push_subscriptions')
            .insert(subData);
        }

        const { data, error } = await query;

        if (error) {
          console.error('Gagal menyimpan langganan:', error);
          showNotification('Gagal menyimpan pendaftaran notifikasi.', 'error');
          return false;
        } else {
          console.log('Langganan berhasil disimpan:', data);
          showNotification('Anda berhasil berlangganan notifikasi!', 'success');
          return true;
        }
      }
      
      async function checkSubscriptionStatus() {
        if (!('serviceWorker' in navigator)) return;
        
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          
          if (subscription) {
            console.log('Pengguna sudah berlangganan (menurut browser).');
            state.pushSubscription = subscription;
            
            const isSaved = await saveSubscriptionToSupabase(subscription);
            
            if (isSaved) {
              $('#notifications-toggle').classList.add('subscribed'); 
            } else {
              $('#notifications-toggle').classList.remove('subscribed'); 
            }
          } else {
            $('#notifications-toggle').classList.remove('subscribed');
          }
        } catch (error) {
          console.error('Gagal cek status subscription:', error);
        }
      }

      async function unsubscribeUserFromPush() {
        if (!('serviceWorker' in navigator)) {
          showNotification('Browser Anda tidak mendukung fitur ini.', 'error');
          return;
        }

        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();

          if (!subscription) {
            showNotification('Anda memang belum berlangganan.', 'success');
            $('#notifications-toggle').classList.remove('subscribed');
            return;
          }

          const unsubscribed = await subscription.unsubscribe();
          if (!unsubscribed) {
            throw new Error('Gagal berhenti berlangganan di browser.');
          }

          const endpoint = subscription.endpoint;
          const { error: dbError } = await supabase
            .from('push_subscriptions')
            .delete()
            .eq('subscription_data->>endpoint', endpoint); 

          if (dbError) {
            console.error('Gagal menghapus langganan dari DB:', dbError);
          }

          state.pushSubscription = null;
          $('#notifications-toggle').classList.remove('subscribed');
          showNotification('Anda berhasil berhenti berlangganan notifikasi.', 'success');

        } catch (error) {
          console.error('Gagal berhenti berlangganan:', error);
          showNotification('Gagal berhenti berlangganan: ' + error.message, 'error');
        }
      }

      async function sendTestNotification() {
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: { 
        title: 'Test Notifikasi', 
        body: 'Ini adalah test notifikasi dari Luminox!',
        url: window.location.href
      }
    });
    if (error) throw error;
    showNotification('Test notifikasi berhasil dikirim!', 'success');
  } catch (error) {
    console.error('Gagal mengirim test notifikasi:', error);
    let msg = 'Gagal mengirim test notifikasi. ';
    if (error.message?.includes('Failed to send a request')) {
      msg += 'Edge function "send-push-notification" tidak ditemukan. Pastikan sudah di-deploy.';
    } else {
      msg += error.message;
    }
    showNotification(msg, 'error');
    showDebugMessage(error);
  }
}

      const showLoading = (loading) => {
        state.isLoading = loading;
        $('#skeleton-grid').classList.toggle('hidden', !loading);
        $('#post-grid').classList.toggle('hidden', loading);
      };

      const createPostElement = (post) => {
        const el = document.createElement('div');
        el.className = 'post-card';
        el.dataset.postId = post.id;
        const isWishlisted = WishlistManager.has(post.id);
        const isModerator = state.profile?.role === 'admin' || state.profile?.role === 'moderator';
        
        const adminActionsHTML = isModerator ? 
            `<button class="edit-btn" title="Edit"><i class="fas fa-pencil-alt"></i></button>
             <button class="delete-btn" title="Hapus"><i class="fas fa-trash"></i></button>` 
            : '';

        el.innerHTML = `<div class="post-card-img-wrapper">${adminActionsHTML}<img src="${post.img}" alt="${post.title}" class="post-card-img"><button class="wishlist-btn ${isWishlisted ? 'wishlisted' : ''}"><i class="fa-regular fa-heart"></i><i class="fa-solid fa-heart"></i></button></div><div class="post-card-content"><div class="post-card-category">${post.category}</div><h3 class="post-card-title">${post.title}</h3><p class="post-card-desc">${post.description.substring(0, 80)}...</p></div>`;
        el.addEventListener('click', (e) => { if (!e.target.closest('.wishlist-btn') && !e.target.closest('.edit-btn') && !e.target.closest('.delete-btn')) { openPostModal(post); } });
        el.querySelector('.wishlist-btn').addEventListener('click', (e) => { e.stopPropagation(); const btn = e.currentTarget; btn.classList.contains('wishlisted') ? WishlistManager.remove(post.id) : WishlistManager.add(post.id); btn.classList.toggle('wishlisted'); if (['wishlist', 'history'].includes(state.currentCategory)) renderPosts(); });
        
        const editBtn = el.querySelector('.edit-btn');
        if (editBtn) { editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(post); }); }

        const deleteBtn = el.querySelector('.delete-btn');
        if (deleteBtn) { 
          deleteBtn.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            handleDeletePost(post); 
          }); 
        }

        return el;
      };

      const renderPosts = () => {
        const grid = $('#post-grid'); grid.innerHTML = ''; let filteredPosts = [];
        if (state.currentCategory === 'wishlist') { const ids = WishlistManager.get(); filteredPosts = state.posts.filter(p => ids.includes(p.id)); } 
        else if (state.currentCategory === 'history') { const ids = HistoryManager.get(); filteredPosts = ids.map(id => state.posts.find(p => p.id === id)).filter(Boolean); } 
        else if (state.currentCategory === 'featured') { filteredPosts = state.posts.filter(p => p.isFeatured); } 
        else { filteredPosts = state.posts.filter(post => { const query = state.searchQuery.toLowerCase(); const matchesSearch = post.title.toLowerCase().includes(query) || post.description.toLowerCase().includes(query); const matchesCategory = !state.currentCategory || post.category.toLowerCase() === state.currentCategory.toLowerCase(); return matchesSearch && matchesCategory; }); }
        if (filteredPosts.length === 0) { const messages = { wishlist: 'Wishlist Anda kosong.', history: 'Riwayat unduhan kosong.', featured: 'Tidak ada pilihan editor saat ini.' }; grid.innerHTML = `<p style="color: var(--muted); text-align: center; grid-column: 1 / -1;">${messages[state.currentCategory] || 'Tidak ada postingan yang cocok.'}</p>`; } 
        else { filteredPosts.forEach(post => grid.appendChild(createPostElement(post))); }
        const titles = { '': 'Postingan Terbaru', wishlist: 'Wishlist Saya', history: 'Riwayat Unduhan', featured: 'Pilihan Editor', addon: 'Addons', template: 'Templates', texturepack: 'TexturePack', game: 'Game', informasi: 'Informasi' };
        $('#page-title').textContent = state.searchQuery ? `Hasil untuk "${state.searchQuery}"` : (titles[state.currentCategory] || 'Postingan');
        $('#skeleton-grid').classList.add('hidden'); $('#post-grid').classList.remove('hidden');
      };
      
      const postModalWrapper = $('#post-modal-wrapper');
      
      async function handleCommentSubmit(e) {
        e.preventDefault();
        const form = e.target; const textarea = form.comment; const content = textarea.value.trim(); const postId = form.dataset.postId;
        if (!content || !state.user) return;
        textarea.value = ''; textarea.disabled = true;
        const { error } = await supabase.from('comments').insert({ content: content, post_id: postId, user_id: state.profile.id });
        textarea.disabled = false;
        if (error) { showNotification('Gagal mengirim komentar: ' + error.message, 'error'); textarea.value = content; }
      }

      function renderCommentUI(postId) {
          const container = $('#comment-form-container');
          if (state.user) {
              const userAvatar = state.profile?.avatar_url || `https://api.dicebear.com/8.x/initials/svg?seed=${state.user.email}`;
              container.innerHTML = `<form id="comment-form" data-post-id="${postId}"><img src="${userAvatar}" alt="Avatar" class="comment-avatar"><textarea name="comment" placeholder="Tulis komentar..." required></textarea><button type="submit"><i class="fas fa-paper-plane"></i></button></form>`;
              $('#comment-form').addEventListener('submit', handleCommentSubmit);
          } else {
              container.innerHTML = `<div id="comment-login-prompt"><i class="fas fa-comments"></i><h3>Login untuk Berkomentar</h3><p><a id="login-to-comment">Login sekarang</a> untuk bergabung dalam diskusi.</p></div>`;
              $('#login-to-comment').addEventListener('click', () => { closePostModal(); handleAuthButtonClick(); });
          }
      }
      
      function timeAgo(date) { const seconds = Math.floor((new Date() - new Date(date)) / 1000); let interval = seconds / 31536000; if (interval > 1) return Math.floor(interval) + " tahun lalu"; interval = seconds / 2592000; if (interval > 1) return Math.floor(interval) + " bulan lalu"; interval = seconds / 86400; if (interval > 1) return Math.floor(interval) + " hari lalu"; interval = seconds / 3600; if (interval > 1) return Math.floor(interval) + " jam lalu"; interval = seconds / 60; if (interval > 1) return Math.floor(interval) + " menit lalu"; return "Baru saja"; }
      function formatChatTimestamp(date) { return new Date(date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); }

      function renderComment(comment) {
        const profile = comment.profiles; const author = profile?.nickname || 'Pengguna'; const avatar = profile?.avatar_url || `https://api.dicebear.com/8.x/initials/svg?seed=${author}`; const role = profile?.role || 'user';
        
        const createRoleBadge = (r) => {
            if (!r) return '';
            const rc = r.toLowerCase();
            let displayText = 'User';
            if (rc === 'admin') {
                displayText = 'Owner';
            } else if (rc === 'moderator') {
                displayText = 'Admin';
            }
            return `<span class="role-badge ${rc}">${displayText}</span>`;
        };

        return `<div class="comment-item"><img src="${avatar}" alt="${author}" class="comment-avatar"><div class="comment-content"><div class="comment-header"><span class="comment-author">${author}</span>${createRoleBadge(role)}<span class="comment-date">${timeAgo(comment.created_at)}</span></div><p class="comment-body">${comment.content}</p></div></div>`;
      }
      
      async function listenToComments(postId) {
        if(state.activeCommentChannel) { state.activeCommentChannel.unsubscribe(); }
        state.activeCommentChannel = supabase.channel(`public:comments:post_id=eq.${postId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, async (payload) => {
                const { data: profileData } = await supabase.from('profiles').select('nickname, avatar_url, role').eq('id', payload.new.user_id).single();
                const newComment = { ...payload.new, profiles: profileData };
                const commentList = $('#comment-list');
                const emptyState = commentList.querySelector('.empty-state');
                if (emptyState) { emptyState.remove(); }
                commentList.insertAdjacentHTML('beforeend', renderComment(newComment));
            })
            .subscribe();
      }
      
      async function loadComments(postId) {
          const list = $('#comment-list'); list.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 1rem 0;">Memuat komentar...</p>';
          const { data, error } = await supabase.from('comments').select('*, profiles(nickname, avatar_url, role)').eq('post_id', postId).order('created_at', { ascending: true });
          if (error) { list.innerHTML = `<p style="color: var(--danger); text-align: center;">Gagal memuat: ${error.message}</p>`; return; }
          if (data.length === 0) { list.innerHTML = '<p class="empty-state" style="color: var(--muted); text-align: center; padding: 1rem 0;">Belum ada komentar.</p>'; }
          else { list.innerHTML = data.map(renderComment).join(''); }
          listenToComments(postId);
      }

      const openPostModal = (post) => {
        $('#post-modal-img').src = post.img; 
        $('#modal-category').textContent = post.category; 
        $('#modal-title').textContent = post.title; 
        $('#modal-desc').textContent = post.description; 
        
        const downloadHandler = () => HistoryManager.add(post.id);
        const buttonsContainer = $('#modal-download-buttons');
        buttonsContainer.innerHTML = ''; 

        if (post.links && typeof post.links === 'object' && Object.keys(post.links).length > 0) {
          for (const [name, url] of Object.entries(post.links)) {
            if (url) { 
              const btn = document.createElement('a');
              btn.href = url;
              btn.target = '_blank';
              btn.className = 'btn-download btn-dynamic'; 
              btn.innerHTML = `<i class="fa-solid fa-download"></i> ${name}`;
              btn.addEventListener('click', downloadHandler, { once: true });
              buttonsContainer.appendChild(btn);
            }
          }
        } else {
          buttonsContainer.innerHTML = '<p style="color: var(--muted); font-size: 0.9rem;">Tidak ada link unduhan.</p>';
        }
        
        renderCommentUI(post.id); 
        loadComments(post.id); 
        postModalWrapper.classList.add('open');
      };
      
      const closePostModal = () => {
        postModalWrapper.classList.remove('open');
        if(state.activeCommentChannel) { state.activeCommentChannel.unsubscribe(); state.activeCommentChannel = null; }
      }
      postModalWrapper.querySelector('.modal-backdrop').addEventListener('click', closePostModal);
      postModalWrapper.querySelector('.close-modal').addEventListener('click', closePostModal);
      
      const switchMainView = (view) => {
        $('main').classList.toggle('hidden', view !== 'posts');
        $('#chat-view').classList.toggle('hidden', view !== 'chat');
      };
      
      const updateActiveNav = () => {
          $$('.menu-item').forEach(item => item.classList.remove('active'));
          $$('.nav-item').forEach(item => item.classList.remove('active'));

          if (!$('#chat-view').classList.contains('hidden')) {
              $('#chat-menu-btn').classList.add('active');
          } else {
              const activeItems = $$(`[data-category="${state.currentCategory}"]`);
              activeItems.forEach(item => item.classList.add('active'));
          }
      }

      $('#theme-toggle').onclick = () => { const newTheme = document.documentElement.dataset.theme === 'dark' ? '' : 'dark'; document.documentElement.dataset.theme = newTheme; $('#theme-toggle i').className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'; localStorage.setItem('luminox_theme', newTheme); };
      $('#menu-toggle').onclick = () => $('#sidebar').classList.add('open') & $('#backdrop').classList.add('active');
      $('#backdrop').onclick = () => $('#sidebar').classList.remove('open') & $('#backdrop').classList.remove('active');
      
      const handleCategoryClick = (e) => {
        if(state.activeChatChannel) { state.activeChatChannel.unsubscribe(); state.activeChatChannel = null; }
        switchMainView('posts');
        state.currentCategory = e.currentTarget.dataset.category;
        state.searchQuery = '';
        $('#header-search-input').value = '';
        $('#app-header').classList.remove('search-active');
        updateActiveNav();
        renderPosts(); 
        if(window.innerWidth < 768) { $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('active'); } 
      };

      $$('[data-category]').forEach(item => item.addEventListener('click', handleCategoryClick));
      $('#search-toggle').onclick = () => { const header = $('#app-header'); header.classList.toggle('search-active'); if (header.classList.contains('search-active')) $('#header-search-input').focus(); else { state.searchQuery = ''; renderPosts(); } };
      $('#header-search-input').addEventListener('input', (e) => { state.searchQuery = e.target.value; renderPosts(); });
      
      async function getProfile(user) { if (!user) return null; const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single(); if (error) { console.error("Gagal mengambil profil:", error); return null; } return data; }
      
      function renderAdminForm(postToEdit = null, formType = 'dlc') {
  const isEditing = postToEdit !== null;
  let title = '';
  let categoryHTML = '';

  if (formType === 'info') {
    title = isEditing ? 'Edit Informasi' : 'Buat Informasi Baru';
    categoryHTML = `<input type="hidden" id="category" name="category" value="Informasi">`;
  } else {
    title = isEditing ? 'Edit Postingan' : 'Buat Postingan Baru';
    categoryHTML = `
      <div class="form-group">
        <label for="category">Kategori</label>
        <select id="category" name="category" required>
  <option value="Template">Template</option>
  <option value="Addon">Addon</option>
  <option value="TexturePack">TexturePack</option>
  <option value="Game">Game</option>
        </select>
      </div>
    `;
  }

  const currentImg = isEditing && postToEdit.img ? postToEdit.img : '';

  authContainer.innerHTML = `
    <div class="form-container">
      <a href="#" class="back-link" id="go-to-profile-view">← Kembali ke Profil</a>
      <div class="form-card">
        <h2>${title}</h2>
        <form id="upload-form" data-editing-id="${isEditing ? postToEdit.id : ''}">
          <div class="form-group">
            <label for="title">Judul <span class="required">*</span></label>
            <input type="text" id="title" name="title" required value="${escapeHtml(postToEdit?.title || '')}" placeholder="Masukkan judul postingan">
          </div>

          <div class="form-group">
            <label for="description">Deskripsi <span class="required">*</span></label>
            <textarea id="description" name="description" rows="5" required placeholder="Jelaskan konten ini...">${escapeHtml(postToEdit?.description || '')}</textarea>
          </div>

          ${categoryHTML}

          <div class="form-group">
            <label>Gambar Postingan <span class="required">*</span></label>
            <div class="image-upload-wrapper">
              <div class="image-preview" id="imagePreview">
                ${currentImg ? `<img src="${currentImg}" alt="Preview">` : '<div class="no-image"><i class="fas fa-image"></i><span>Belum ada gambar</span></div>'}
              </div>
              <div class="upload-actions">
                <label for="imgFile" class="btn-upload"><i class="fas fa-cloud-upload-alt"></i> Pilih Gambar</label>
                <input type="file" id="imgFile" name="img-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
                <small class="hint">Maks 5MB, format JPG, PNG, WEBP, GIF</small>
              </div>
              <input type="hidden" id="imgUrl" name="img-url" value="${currentImg}">
            </div>
          </div>

          <div class="form-group">
            <label>Link Unduhan</label>
            <div id="linksContainer" class="links-container"></div>
            <button type="button" id="addLinkBtn" class="btn-add-link"><i class="fas fa-plus-circle"></i> Tambah Link</button>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" id="isFeatured" name="isFeatured" ${isEditing && postToEdit?.isFeatured ? 'checked' : ''}>
              <span>Jadikan Pilihan Editor</span>
            </label>
          </div>

          <div class="form-actions">
            <button type="submit" id="submitBtn" class="btn-submit"><i class="fas fa-save"></i> ${isEditing ? 'Simpan Perubahan' : 'Upload Postingan'}</button>
          </div>
        </form>
        <button id="logoutBtn" class="btn-logout"><i class="fas fa-sign-out-alt"></i> Logout</button>
      </div>
    </div>
  `;

  // Set value untuk select category jika edit
  if (isEditing && formType !== 'info') {
    const catSelect = document.getElementById('category');
    if (catSelect) catSelect.value = postToEdit.category;
  }

  // Preview gambar
  const fileInput = document.getElementById('imgFile');
  const previewDiv = document.getElementById('imagePreview');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        showNotification('Ukuran gambar terlalu besar. Maksimal 5MB.', 'error');
        fileInput.value = '';
        return;
      }
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowed.includes(file.type)) {
        showNotification('Format tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.', 'error');
        fileInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        previewDiv.innerHTML = `<img src="${ev.target.result}" alt="Preview">`;
      };
      reader.readAsDataURL(file);
    } else {
      const oldImg = document.getElementById('imgUrl').value;
      if (oldImg) {
        previewDiv.innerHTML = `<img src="${oldImg}" alt="Preview">`;
      } else {
        previewDiv.innerHTML = '<div class="no-image"><i class="fas fa-image"></i><span>Belum ada gambar</span></div>';
      }
    }
  });

  // Dynamic links
  const linksContainer = document.getElementById('linksContainer');
  const addLinkRow = (name = '', url = '') => {
    const div = document.createElement('div');
    div.className = 'link-row';
    div.innerHTML = `
      <input type="text" class="link-name" placeholder="Nama (contoh: MediaFire)" value="${escapeHtml(name)}" required>
      <input type="url" class="link-url" placeholder="URL link" value="${escapeHtml(url)}" required>
      <button type="button" class="remove-link"><i class="fas fa-trash-alt"></i></button>
    `;
    linksContainer.appendChild(div);
    div.querySelector('.remove-link').addEventListener('click', () => div.remove());
  };

  document.getElementById('addLinkBtn').addEventListener('click', () => addLinkRow());

  if (isEditing && postToEdit?.links && typeof postToEdit.links === 'object') {
    for (const [name, url] of Object.entries(postToEdit.links)) {
      if (url) addLinkRow(name, url);
    }
  } else if (!isEditing) {
    addLinkRow();
  }

  document.getElementById('upload-form').addEventListener('submit', handleSubmit);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('go-to-profile-view').addEventListener('click', (e) => {
    e.preventDefault();
    renderProfileView();
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

      async function handleRoleUpdate(userId, newRole) { const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId); if (error) { showNotification(`Gagal mengubah role: ${error.message}`, 'error'); } else { showNotification('Role pengguna berhasil diubah.', 'success'); } }
      async function renderUserManagementView() {
          authContainer.innerHTML = `<a href="#" class="admin-nav-link" id="go-to-profile-view">Kembali ke Profil</a><h2>Kelola Pengguna</h2><div id="user-list-container">Memuat pengguna...</div>`;
          $('#go-to-profile-view').addEventListener('click', (e) => { e.preventDefault(); renderProfileView(); });
          const { data: profiles, error } = await supabase.from('profiles').select('id, nickname, role');
          if (error) { $('#user-list-container').innerHTML = `<p style="color:var(--danger);">Gagal memuat pengguna: ${error.message}</p>`; return; }
          const currentAdminId = state.user.id;
          
          const userListHTML = profiles.map(profile => { const nickname = profile.nickname || 'Tanpa Nickname'; const isCurrentUser = profile.id === currentAdminId; return `<li class="user-management-item"><div class="user-management-info"><span class="nickname">${nickname}</span></div><div class="user-management-role"><select data-user-id="${profile.id}" ${isCurrentUser ? 'disabled' : ''}><option value="user" ${profile.role === 'user' ? 'selected' : ''}>User</option><option value="moderator" ${profile.role === 'moderator' ? 'selected' : ''}>Admin</option><option value="admin" ${profile.role === 'admin' ? 'selected' : ''}>Owner</option></select></div></li>`; }).join('');
          
          $('#user-list-container').innerHTML = `<ul class="user-management-list">${userListHTML}</ul>`;
          $$('.user-management-role select').forEach(select => { select.addEventListener('change', (e) => { const userId = e.target.dataset.userId; const newRole = e.target.value; handleRoleUpdate(userId, newRole); }); });
      }

async function handleDeleteRequest(e) {
  const button = e.currentTarget; 
  const requestId = button.dataset.id;
  
  if (!requestId) {
    console.error('Tidak ada ID request pada tombol.');
    return;
  }

  if (!confirm('Anda yakin ingin menghapus request ini?')) {
    return;
  }

  button.disabled = true;
  button.textContent = 'Menghapus...';

  const { error } = await supabase
    .from('requests')
    .delete()
    .eq('id', requestId);
  
  if (error) { 
    showNotification('Gagal menghapus request: ' + error.message, 'error'); 
    button.disabled = false;
    button.textContent = 'Hapus';
  } else { 
    showNotification('Request berhasil dihapus.', 'success'); 
    renderRequestManagementView();
  }
}
      async function renderRequestManagementView() {
        authContainer.innerHTML = `<a href="#" class="admin-nav-link" id="go-to-profile-view">Kembali ke Profil</a><h2>Kelola Request Pengguna</h2><div id="request-list-container">Memuat request...</div>`;
        $('#go-to-profile-view').addEventListener('click', (e) => { e.preventDefault(); renderProfileView(); });
        const { data: requests, error } = await supabase.from('requests').select('*, profiles(nickname)').order('created_at', { ascending: false });
        if (error) { $('#request-list-container').innerHTML = `<p style="color:var(--danger);">Gagal memuat request: ${error.message}</p>`; return; }
        if (requests.length === 0) { $('#request-list-container').innerHTML = '<p style="color:var(--muted); text-align:center;">Belum ada request dari pengguna.</p>'; return; }
        const requestListHTML = requests.map(req => { const nickname = req.profiles?.nickname || 'Pengguna Anonim'; const description = req.description || '<em>Tidak ada deskripsi.</em>'; return `<li class="request-management-item"><div class="request-management-header"><h4 class="request-management-title">${req.title}</h4><span class="request-management-category">${req.category}</span></div><p class="request-management-user">Dari: <strong>${nickname}</strong></p><p class="request-management-desc">${description}</p><div class="request-management-actions"><button data-id="${req.id}" class="delete-request-btn delete-btn">Hapus</button></div></li>`; }).join('');
        $('#request-list-container').innerHTML = `<ul class="request-management-list">${requestListHTML}</ul>`;
        $$('.delete-request-btn').forEach(button => { button.addEventListener('click', handleDeleteRequest); });
      }

      const openEditModal = (post) => {
        const formType = (post.category.toLowerCase() === 'informasi') ? 'info' : 'dlc';
        renderAdminForm(post, formType);
        openAuthModal();
      };

      async function handleRegister(e) { e.preventDefault(); const email = e.target.email.value; const password = e.target.password.value; const { error } = await supabase.auth.signUp({ email, password }); if (error) { showNotification("Pendaftaran Gagal: " + error.message, 'error'); } else { showNotification('Pendaftaran berhasil! Silakan cek email Anda untuk konfirmasi.', 'success'); renderLoginView(); } }
      function renderLoginView() { authContainer.innerHTML = `<div id="login-view"><h2>Login</h2><form id="login-form"><label for="email">Email:</label><input type="email" id="email" name="email" required autocomplete="email"><label for="password">Password:</label><input type="password" id="password" name="password" required autocomplete="current-password"><button type="submit">Login</button></form><p style="text-align: center; margin-top: 1rem; font-size: 0.9rem;">Belum punya akun? <a href="#" id="show-register">Daftar</a></p></div>`; authContainer.querySelector('#login-form').addEventListener('submit', handleLogin); authContainer.querySelector('#show-register').addEventListener('click', (e) => { e.preventDefault(); renderRegisterView(); }); }
      function renderRegisterView() { authContainer.innerHTML = `<div id="register-view"><h2>Daftar Akun Baru</h2><form id="register-form"><label for="register-email">Email:</label><input type="email" id="register-email" name="email" required autocomplete="email"><label for="register-password">Password:</label><input type="password" id="register-password" name="password" required autocomplete="new-password"><button type="submit">Daftar</button></form><p style="text-align: center; margin-top: 1rem; font-size: 0.9rem;">Sudah punya akun? <a href="#" id="show-login">Login</a></p></div>`; authContainer.querySelector('#register-form').addEventListener('submit', handleRegister); authContainer.querySelector('#show-login').addEventListener('click', (e) => { e.preventDefault(); renderLoginView(); }); }
      
      async function renderProfileView() {
          const user = state.user; const profile = state.profile;
          if (user && profile) {
              const isModerator = profile.role === 'admin' || profile.role === 'moderator';
              const isAdmin = profile.role === 'admin';
              
              const avatarSrc = profile.avatar_url || `https://api.dicebear.com/8.x/initials/svg?seed=${user.email}`;

              const uploadDlcButtonHTML = isModerator ? 
                `<button id="upload-dlc-btn" class="admin-action-btn">
                    <i class="fas fa-plus-square"></i>
                    <span>Upload DLC</span>
                 </button>` : '';
              const uploadInfoButtonHTML = isModerator ?
                `<button id="upload-info-btn" class="admin-action-btn">
                    <i class="fas fa-info-circle"></i>
                    <span>Upload Info</span>
                </button>` : '';
              const userManagementButtonHTML = isAdmin ? 
                `<button id="manage-users-btn" class="admin-action-btn">
                    <i class="fas fa-users"></i>
                    <span>Kelola User</span>
                 </button>` : '';
              const requestManagementButtonHTML = isModerator ? 
                `<button id="manage-requests-btn" class="admin-action-btn">
                    <i class="fas fa-inbox"></i>
                    <span>Kelola Request</span>
                 </button>` : '';
              
              const testNotificationButtonHTML = isModerator ? 
                `<button id="test-notification-btn" class="admin-action-btn">
                    <i class="fas fa-bell"></i>
                    <span>Test Notif</span>
                 </button>` : '';

              authContainer.innerHTML = `
                <form id="profile-form">
                    <h2>Profil Saya</h2>
                    <div class="profile-header">
                        <div class="profile-avatar-wrapper">
                            <img src="${avatarSrc}" alt="Avatar" class="profile-avatar" id="avatar-preview">
                            <label for="avatar-upload" id="avatar-upload-label"><i class="fas fa-camera"></i></label>
                            <input type="file" id="avatar-upload" name="avatar" class="hidden" accept="image/png, image/jpeg">
                        </div>
                    </div>
                    <label for="nickname">Nickname:</label>
                    <input type="text" id="nickname" name="nickname" value="${profile.nickname || ''}" placeholder="Masukkan nickname Anda">
                    <label for="email" style="margin-top:0.5rem;">Email:</label>
                    <input type="email" id="email" name="email" value="${user.email}" disabled>
                    <button type="submit">Simpan Perubahan</button>
                </form>
                
                <div class="admin-actions-grid">
                    ${uploadDlcButtonHTML}
                    ${uploadInfoButtonHTML}
                    ${userManagementButtonHTML}
                    ${requestManagementButtonHTML}
                    ${testNotificationButtonHTML} </div>
                
                <button id="logout-btn">Logout</button>
              `;
              
              authContainer.querySelector('#profile-form').addEventListener('submit', handleProfileUpdate); 
              authContainer.querySelector('#logout-btn').addEventListener('click', handleLogout); 
              authContainer.querySelector('#avatar-upload').addEventListener('change', (e) => { 
                  const file = e.target.files[0]; 
                  if (file) { 
                      const reader = new FileReader(); 
                      reader.onload = (event) => { $('#avatar-preview').src = event.target.result; }; 
                      reader.readAsDataURL(file); 
                  } 
              });

              if(isModerator) { 
                  const dlcBtn = $('#upload-dlc-btn');
                  if (dlcBtn) dlcBtn.addEventListener('click', (e) => { e.preventDefault(); renderAdminForm(null, 'dlc'); });

                  const infoBtn = $('#upload-info-btn');
                  if (infoBtn) infoBtn.addEventListener('click', (e) => { e.preventDefault(); renderAdminForm(null, 'info'); });
                  
                  const reqBtn = $('#manage-requests-btn');
                  if (reqBtn) reqBtn.addEventListener('click', (e) => { e.preventDefault(); renderRequestManagementView(); });
                  
                  const testBtn = $('#test-notification-btn');
                  if (testBtn) testBtn.addEventListener('click', sendTestNotification);
              }
              if(isAdmin) { 
                  const userBtn = $('#manage-users-btn');
                  if (userBtn) userBtn.addEventListener('click', (e) => { e.preventDefault(); renderUserManagementView(); });
              }
          } else { 
              renderLoginView(); 
          }
      }

      async function handleProfileUpdate(e) {
          e.preventDefault(); const form = e.target; const user = state.user; const newNickname = form.nickname.value; const avatarFile = form.avatar.files[0]; let avatar_url = state.profile.avatar_url;
          if (avatarFile) {
              const fileExt = avatarFile.name.split('.').pop(); const fileName = `${user.id}.${fileExt}`; const filePath = `${fileName}`;
              const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, avatarFile, { upsert: true }); if (uploadError) { showNotification('Gagal mengunggah foto profil: ' + uploadError.message, 'error'); return; }
              const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath); avatar_url = urlData.publicUrl + `?t=${new Date().getTime()}`;
          }
          const { error: updateError } = await supabase.from('profiles').update({ nickname: newNickname, avatar_url: avatar_url }).eq('id', user.id);
          if (updateError) { showNotification('Gagal memperbarui profil: ' + updateError.message, 'error'); } else { showNotification('Profil berhasil diperbarui!', 'success'); state.profile.nickname = newNickname; state.profile.avatar_url = avatar_url; renderProfileView(); }
      }
      async function setupUIBasedOnAuth() {
        const { data: { user } } = await supabase.auth.getUser(); state.user = user;
        if (user) { 
          const profile = await getProfile(user); 
          state.profile = profile; 
          $('#auth-menu-text').textContent = 'Akun Saya'; 
        } else { 
          state.profile = null; 
          $('#auth-menu-text').textContent = 'Login/Register'; 
        }
        await checkSubscriptionStatus(); 
        renderPosts();
      }
      async function handleLogin(e) {
        e.preventDefault(); const email = e.target.email.value; const password = e.target.password.value;
        const { error, data } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { showNotification("Login Gagal: " + error.message, 'error'); } else { 
          showNotification('Login berhasil!', 'success'); 
          state.user = data.user; 
          state.profile = await getProfile(data.user); 
          await setupUIBasedOnAuth();
          await renderProfileView(); 
        }
      }
      async function handleLogout() { 
        await supabase.auth.signOut(); 
        state.user = null; 
        state.profile = null; 
        await setupUIBasedOnAuth();
        showNotification('Anda telah logout.', 'success'); 
        closeAuthModal(); 
      }

      // ================= MODIFIKASI HANDLE SUBMIT =================
      async function handleSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const editingId = form.dataset.editingId;
        const submitBtn = form.querySelector('#submit-post-btn');
        const originalBtnText = submitBtn.textContent;
        
        // Proses upload gambar jika ada file baru
        let imageUrl = form['img-url'].value; // URL lama (jika ada)
        const imageFile = form['img-file'].files[0];
        
        // Validasi: jika buat baru dan tidak ada file, tolak
        if (!imageFile && !imageUrl && !editingId) {
          showNotification('Harap pilih gambar untuk postingan.', 'error');
          return;
        }
        
        // Disable tombol submit selama proses
        submitBtn.disabled = true;
        submitBtn.textContent = 'Mengupload...';
        
        if (imageFile) {
          // Upload ke bucket 'post-images'
          const fileExt = imageFile.name.split('.').pop();
          const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
          const filePath = `${fileName}`;
          
          const { error: uploadError, data } = await supabase.storage
            .from('post-images')
            .upload(filePath, imageFile);
          
          if (uploadError) {
            showNotification('Gagal upload gambar: ' + uploadError.message, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
            return;
          }
          
          // Dapatkan public URL
          const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(filePath);
          imageUrl = urlData.publicUrl;
        }
        
        // Kumpulkan links
        const links = {};
        $$('#dynamic-links-container .link-entry').forEach(entry => {
          const name = entry.querySelector('.link-name-input').value.trim();
          const url = entry.querySelector('.link-url-input').value.trim();
          if (name && url) links[name] = url;
        });

        const postData = {
          title: form.title.value,
          description: form.description.value,
          category: form.category.value,
          isFeatured: form.isFeatured.checked,
          img: imageUrl,
          links: links
        };

        const { error } = editingId
          ? await supabase.from('posts').update(postData).eq('id', editingId)
          : await supabase.from('posts').insert([postData]);
        
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
        
        if (error) {
          showNotification('Operasi Gagal: ' + error.message, 'error');
        } else {
          showNotification(`Postingan berhasil ${editingId ? 'diperbarui' : 'dibuat'}!`, 'success');
          form.reset();
          closeAuthModal();
          // Refresh daftar postingan
          await fetchPosts();
          
          if (!editingId) {
            // Kirim notifikasi push (opsional)
            try {
              await supabase.functions.invoke('send-push-notification', {
                body: {
                  title: 'Postingan Baru!',
                  body: `Cek ${postData.category} terbaru: ${postData.title}`
                }
              });
            } catch (notifErr) {
              console.warn('Notifikasi gagal:', notifErr);
            }
          }
        }
      }

      async function handleDeletePost(post) {
        if (!confirm(`Anda yakin ingin menghapus postingan "${post.title}"? Tindakan ini tidak bisa dibatalkan.`)) {
          return;
        }

        try {
          const { error } = await supabase
            .from('posts')
            .delete()
            .eq('id', post.id);

          if (error) {
            throw error;
          }

          showNotification('Postingan berhasil dihapus.', 'success');
          state.posts = state.posts.filter(p => p.id !== post.id);
          renderPosts();

        } catch (error) {
          showNotification('Gagal menghapus postingan: ' + error.message, 'error');
          console.error('Gagal Hapus Postingan:', error);
        }
      }

      async function fetchPosts() { try { const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false }); if (error) throw error; state.posts = data; renderPosts(); } catch (error) { console.error('Gagal memuat data postingan:', error); $('#post-grid').innerHTML = `<p style="color: var(--muted); text-align: center;">Gagal memuat data. Silakan coba lagi nanti.</p>`; showNotification('Gagal memuat data postingan.', 'error'); } }
      
      function renderRequestView() {
        if (state.user) { 
          requestContainer.innerHTML = `
            <h2>Buat Request</h2>
            <p style="font-size: 0.9rem; color: var(--muted); margin-top: -0.5rem; margin-bottom: 1.5rem;">Ingin Addon, Template, TexturePack, atau Game yang kalian mau? Silahkan ajukan request Anda!</p>
            <form id="request-form">
              <label for="request-title">Nama Item/Game:</label>
              <input type="text" id="request-title" name="title" required placeholder="Contoh: Shader Realistis">
              <label for="request-category">Kategori:</label>
              <select id="request-category" name="category" required>
                <option value="" disabled selected>Pilih Kategori</option>
                <option value="Addon">Addon</option>
                <option value="Template">Template</option>
                <option value="TexturePack">TexturePack</option>
                <option value="Game">Game</option>
              </select>
              <label for="request-description">Deskripsi (Opsional):</label>
              <textarea id="request-description" name="description" rows="3" placeholder="Jelaskan lebih detail tentang request Anda..."></textarea>
              <button type="submit">Kirim Request</button>
            </form>
          `; 
          $('#request-form').addEventListener('submit', handleRequestSubmit); 
        }
        else { 
          requestContainer.innerHTML = `
            <div class="chat-login-prompt">
              <i class="fas fa-lock"></i>
              <h3>Login Diperlukan</h3>
              <p>Anda harus login terlebih dahulu untuk dapat mengajukan request.</p>
              <button id="login-from-request" style="width: auto; padding: 0.6rem 1.5rem;">Login Sekarang</button>
            </div>
          `; 
          $('#login-from-request').addEventListener('click', () => { closeRequestModal(); handleAuthButtonClick(); }); 
        }
      }
      
async function handleRequestSubmit(e) {
  e.preventDefault(); 
  const form = e.target;
  
  const requestData = { 
    title: form.title.value, 
    category: form.category.value, 
    description: form.description.value, 
    user_id: state.user.id 
  };

  console.log('📝 Mengirim request:', requestData);

  const { data: newRecord, error } = await supabase
    .from('requests')
    .insert(requestData)
    .select()
    .single();

  if (error) { 
    console.error('❌ Database error:', error);
    showNotification('Gagal mengirim request: ' + error.message, 'error'); 
    return;
  } 

  console.log('✅ Request saved to database:', newRecord);
  showNotification('Request berhasil dikirim! Silahkan ditunggu.', 'success'); 
  form.reset();
  closeRequestModal();
  
  try {
    console.log('🔔 Mengirim notifikasi Telegram...');
    
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('id', state.user.id)
      .single();

    const telegramPayload = {
      record: newRecord,
      user_profile: userProfile || { nickname: 'Pengguna Anonim' }
    };

    console.log('📨 Telegram payload:', telegramPayload);

    const { data, error: telegramError } = await supabase.functions.invoke('telegram-notify', {
      body: telegramPayload
    });
    
    if (telegramError) {
      console.warn('❌ Telegram function tidak tersedia:', telegramError);
      showNotification('Request tersimpan, tetapi notifikasi Telegram gagal (Edge Function tidak ditemukan).', 'error');
    } else {
      console.log('✅ Telegram function result:', data);
    }
  } catch (err) {
    console.error('❌ Unexpected Telegram error:', err);
    showDebugMessage(err);
  }
}
      
      function renderChatMessage(message) {
          const profile = message.profiles;
          const author = profile?.nickname || 'Pengguna';
          const avatar = profile?.avatar_url || `https://api.dicebear.com/8.x/initials/svg?seed=${author}`;
          const isCurrentUser = state.user && message.user_id === state.user.id;
          const editedTag = message.updated_at && message.created_at !== message.updated_at ? `<span class="message-edited-tag">(diedit)</span>` : '';

          const messageNode = document.createElement('div');
          messageNode.className = `chat-message ${isCurrentUser ? 'current-user' : ''}`;
          messageNode.dataset.messageId = message.id;
          messageNode.innerHTML = `<img src="${avatar}" alt="${author}" class="message-avatar"><div class="message-content"><div class="message-meta"><span class="message-author">${author}</span><span class="message-timestamp">${formatChatTimestamp(message.created_at)} ${editedTag}</span></div><div class="message-bubble"><p class="message-text">${message.content}</p></div></div>`;
          
          if(isCurrentUser) {
              let pressTimer;
              const bubble = messageNode.querySelector('.message-bubble');
              bubble.addEventListener('mousedown', (e) => { pressTimer = window.setTimeout(() => showMessageContextMenu(e, message), 500); });
              bubble.addEventListener('touchstart', (e) => { pressTimer = window.setTimeout(() => showMessageContextMenu(e, message), 500); });
              bubble.addEventListener('mouseup', () => clearTimeout(pressTimer));
              bubble.addEventListener('mouseleave', () => clearTimeout(pressTimer));
              bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
          }
          return messageNode;
      }
      async function handleChatSubmit(e) {
        e.preventDefault();
        const form = e.target; const input = form.message; const content = input.value.trim();
        if (!content || !state.user) return;
        input.value = '';
        const { error } = await supabase.from('messages').insert({ content, user_id: state.user.id });
        if (error) { console.error("Error sending message:", error); showNotification('Gagal mengirim pesan: ' + error.message, 'error'); input.value = content; }
      }
      
      async function renderChatView() {
          $('#page-title').textContent = 'Global Chat';
          const chatView = $('#chat-view');
          
          if (!state.user) {
              chatView.innerHTML = `<div class="chat-login-prompt"><i class="fas fa-comments"></i><h3>Login untuk Chat</h3><p>Anda harus login untuk bisa bergabung di chat global.</p><button id="login-from-chat" style="width: auto; padding: 0.6rem 1.5rem;">Login Sekarang</button></div>`;
              $('#login-from-chat').addEventListener('click', handleAuthButtonClick);
              return;
          }

          chatView.innerHTML = `<div id="chat-view-container"><div class="chat-messages" id="chat-messages-container"><p style="text-align:center; color: var(--muted);">Memuat pesan...</p></div><form id="chat-form"><input type="text" name="message" placeholder="Ketik pesan..." autocomplete="off" required><button type="submit" aria-label="Kirim Pesan"><i class="fas fa-paper-plane"></i></button></form></div>`;
          $('#chat-form').addEventListener('submit', handleChatSubmit);

          const messagesContainer = $('#chat-messages-container');
          const scrollToBottom = () => { messagesContainer.scrollTop = messagesContainer.scrollHeight; };
          
          const { data, error } = await supabase.from('messages').select('*, profiles(nickname, avatar_url)').order('created_at').limit(100);
          if (error) { messagesContainer.innerHTML = `<p style="text-align:center; color:var(--danger)">Gagal memuat pesan: ${error.message}</p>`; return; }

          if(data.length === 0) { messagesContainer.innerHTML = `<p class="empty-state" style="text-align:center; color: var(--muted);">Jadilah yang pertama mengirim pesan!</p>`; }
          else { messagesContainer.innerHTML = ''; data.forEach(msg => messagesContainer.appendChild(renderChatMessage(msg))); scrollToBottom(); }
          
          if(state.activeChatChannel) { state.activeChatChannel.unsubscribe(); }

          state.activeChatChannel = supabase.channel('public:messages')
              .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async (payload) => {
                  const messagesContainer = $('#chat-messages-container');
                  switch (payload.eventType) {
                      case 'INSERT':
                          const { data: profileData } = await supabase.from('profiles').select('nickname, avatar_url').eq('id', payload.new.user_id).single();
                          const emptyState = messagesContainer.querySelector('.empty-state');
                          if (emptyState) { emptyState.remove(); }
                          const messageWithProfile = { ...payload.new, profiles: profileData };
                          messagesContainer.appendChild(renderChatMessage(messageWithProfile));
                          scrollToBottom();
                          break;
                      case 'UPDATE':
                          const updatedMsgNode = $(`[data-message-id="${payload.new.id}"]`);
                          if (updatedMsgNode) {
                              updatedMsgNode.querySelector('.message-text').textContent = payload.new.content;
                              const timestampNode = updatedMsgNode.querySelector('.message-timestamp');
                              if (!timestampNode.querySelector('.message-edited-tag')) {
                                  timestampNode.innerHTML += ' <span class="message-edited-tag">(diedit)</span>';
                              }
                          }
                          break;
                      case 'DELETE':
                          const deletedMsgNode = $(`[data-message-id="${payload.old.id}"]`);
                          if(deletedMsgNode) deletedMsgNode.remove();
                          break;
                  }
              })
              .subscribe();
      }
      
      function listenToPosts() {
          if (state.activePostsChannel) return;
          state.activePostsChannel = supabase.channel('public:posts')
              .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, (payload) => {
                  console.log('Perubahan postingan diterima!', payload);
                  switch (payload.eventType) {
                      case 'INSERT': state.posts.unshift(payload.new); break;
                      case 'UPDATE': const index = state.posts.findIndex(p => p.id === payload.new.id); if (index !== -1) state.posts[index] = payload.new; break;
                      case 'DELETE': state.posts = state.posts.filter(p => p.id !== payload.old.id); break;
                  }
                  renderPosts();
              })
              .subscribe();
      }
      
      const contextMenu = $('#message-context-menu');

      function showMessageContextMenu(e, message) {
          e.preventDefault();
          contextMenu.style.display = 'block';
          const rect = e.target.getBoundingClientRect();
          let top = e.pageY || e.touches[0].pageY;
          let left = e.pageX || e.touches[0].pageX;
          
          contextMenu.style.top = `${top}px`;
          contextMenu.style.left = `${left}px`;
          
          const menuRect = contextMenu.getBoundingClientRect();
          if (menuRect.right > window.innerWidth) {
            contextMenu.style.left = `${window.innerWidth - menuRect.width - 5}px`;
          }
           if (menuRect.bottom > window.innerHeight) {
            contextMenu.style.top = `${window.innerHeight - menuRect.height - 5}px`;
          }

          $('#edit-msg-btn').onclick = () => startEditMessage(message.id);
          $('#delete-msg-btn').onclick = () => deleteMessage(message.id);

          setTimeout(() => { document.addEventListener('click', hideContextMenu, { once: true }); }, 100);
      }

      function hideContextMenu() { contextMenu.style.display = 'none'; }

      async function deleteMessage(messageId) {
          if (confirm('Anda yakin ingin menghapus pesan ini?')) {
              const { error } = await supabase.from('messages').delete().eq('id', messageId);
              if (error) { showNotification('Gagal menghapus pesan: ' + error.message, 'error'); }
          }
      }

      function startEditMessage(messageId) {
          const messageNode = $(`[data-message-id="${messageId}"]`);
          const bubble = messageNode.querySelector('.message-bubble');
          const currentText = messageNode.querySelector('.message-text').textContent;
          
          bubble.innerHTML = `
              <form class="message-edit-form">
                  <textarea required>${currentText}</textarea>
                  <div class="edit-actions">
                      <button type="button" class="cancel-btn">Batal</button>
                      <button type="submit">Simpan</button>
                  </div>
              </form>
          `;
          
          const form = bubble.querySelector('form');
          const textarea = form.querySelector('textarea');
          textarea.focus();
          textarea.setSelectionRange(currentText.length, currentText.length);

          form.querySelector('.cancel-btn').addEventListener('click', () => {
              bubble.innerHTML = `<p class="message-text">${currentText}</p>`;
          });

          form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const newText = textarea.value.trim();
              if (newText && newText !== currentText) {
                  const { error } = await supabase.from('messages').update({ content: newText, updated_at: new Date().toISOString() }).eq('id', messageId);
                  if (error) { showNotification('Gagal mengedit pesan: ' + error.message, 'error'); }
              } else {
                  bubble.innerHTML = `<p class="message-text">${currentText}</p>`;
              }
          });
      }

      const welcomePopup = $('#welcome-popup-wrapper');
      if (welcomePopup) {
          const welcomePopupBackdrop = welcomePopup.querySelector('.popup-backdrop');
          const welcomePopupClose = welcomePopup.querySelector('.popup-close-btn');

          const openWelcomePopup = () => welcomePopup.classList.add('open');
          const closeWelcomePopup = () => {
              welcomePopup.classList.remove('open');
              try {
                  sessionStorage.setItem('luminoxPopupShown', 'true');
              } catch (e) {
                  console.warn('Gagal menyimpan ke sessionStorage:', e);
              }
          };

          welcomePopupClose.addEventListener('click', closeWelcomePopup);
          welcomePopupBackdrop.addEventListener('click', closeWelcomePopup);

          try {
              if (!sessionStorage.getItem('luminoxPopupShown')) {
                  setTimeout(openWelcomePopup, 1000);
              }
          } catch (e) {
              console.warn('Gagal mengakses sessionStorage:', e);
              setTimeout(openWelcomePopup, 1000);
          }
      }


      const init = async () => {
        const savedTheme = localStorage.getItem('luminox_theme') || '';
        if (savedTheme) { document.documentElement.dataset.theme = savedTheme; $('#theme-toggle i').className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'; }
        const skeletonGrid = $('#skeleton-grid');
        const skeletonCardHTML = `<div class="skeleton-card"><div class="skeleton-img shimmer"></div><div class="skeleton-content"><div class="skeleton-line shimmer" style="width: 35%;"></div><div class="skeleton-line shimmer" style="width: 85%;"></div><div class="skeleton-line shimmer" style="width: 60%;"></div></div></div>`;
        skeletonGrid.innerHTML = Array(4).fill(skeletonCardHTML).join('');
        
        await registerServiceWorker(); 
        await fetchPosts();
        await setupUIBasedOnAuth();
        listenToPosts();
      };
      
      const handleAuthButtonClick = async () => { if (state.user) { await renderProfileView(); } else { renderLoginView(); } openAuthModal(); };
      const handleRequestButtonClick = () => { renderRequestView(); openRequestModal(); };
      const handleChatButtonClick = () => {
        switchMainView('chat');
        updateActiveNav();
        renderChatView();
        if(window.innerWidth < 768) { $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('active'); }
      };
      
      $('#auth-menu-btn').addEventListener('click', handleAuthButtonClick);
      $('#auth-bottom-nav-btn').addEventListener('click', handleAuthButtonClick);
      $('#request-menu-btn').addEventListener('click', handleRequestButtonClick);
      $('#chat-menu-btn').addEventListener('click', handleChatButtonClick);
      
      $('#notifications-toggle').addEventListener('click', () => {
        if ($('#notifications-toggle').classList.contains('subscribed')) {
          if (confirm('Anda yakin ingin berhenti berlangganan notifikasi?')) {
            unsubscribeUserFromPush();
          }
        } else {
          askNotificationPermission();
        }
      });
      
      init();
    });