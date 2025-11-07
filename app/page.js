// app/page.js
'use client'; // <-- WAJIB! Ini menandakan Client Component

import { useState } from 'react';

// Konfigurasi API
const API_BASE_URL = 'https://alya-chan.my.id/v1';

export default function Home() {
  // === STATE MANAGEMENT ===
  // 'useState' adalah "React Hooks" untuk menyimpan data
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('search'); // 'search' atau 'episodes'
  const [currentTitle, setCurrentTitle] = useState('');

  // === FUNGSI API ===

  // 1. Mencari Anime (Library)
  const handleSearch = async () => {
    if (!query) return; // Jangan cari jika kosong
    setLoading(true);
    setEpisodes([]); // Kosongkan daftar episode lama
    setView('search');
    setCurrentTitle('');

    try {
      const response = await fetch(`${API_BASE_URL}/Library?page=1&s=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (data.status === 200 && data.data.length > 0) {
        setResults(data.data);
      } else {
        setResults([]); // Kosongkan jika tidak ketemu
      }
    } catch (error) {
      console.error("Gagal mencari anime:", error);
      alert(`Error: ${error.message}`);
    }
    setLoading(false);
  };

  // 2. Mengambil Detail Anime (Daftar Episode)
  const fetchAnimeDetails = async (slug, title) => {
    setLoading(true);
    setView('episodes'); // Ganti tampilan ke daftar episode
    setCurrentTitle(title);

    try {
      const response = await fetch(`${API_BASE_URL}/anime/${slug}`);
      const data = await response.json();
      if (data.status === 200 && data.data.episode.length > 0) {
        setEpisodes(data.data.episode);
      } else {
        setEpisodes([]);
      }
    } catch (error) {
      console.error("Gagal mengambil detail:", error);
      alert(`Error: ${error.message}`);
    }
    setLoading(false);
  };

  // 3. Mengambil Link Streaming
  const fetchStreamingLink = async (slug, title) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/episode/${slug}`);
      const data = await response.json();
      if (data.status === 200 && data.data.stream_url) {
        // BERHASIL! Tampilkan link-nya
        // Nanti bisa diganti dengan video player
        alert(`Link streaming untuk ${title}:\n\n${data.data.stream_url}`);
      } else {
        alert('Gagal mendapatkan link streaming.');
      }
    } catch (error) {
      console.error("Gagal mengambil link stream:", error);
      alert(`Error: ${error.message}`);
    }
    setLoading(false);
  };

  // === FUNGSI TAMPILAN (UI) ===

  // Fungsi untuk kembali ke hasil pencarian
  const goBackToSearch = () => {
    setView('search');
    setEpisodes([]);
    setCurrentTitle('');
    // State 'results' masih tersimpan, jadi pencarian lama akan tampil lagi
  };

  // === RENDER KOMPONEN ===
  // Ini adalah bagian JSX (HTML di dalam JavaScript)
  return (
    <main className="container">
      <h1>Luminox Stream (Next.js)</h1>

      {/* Tampilkan Tombol Back atau Search Bar */}
      {view === 'episodes' ? (
        <button className="back-button" onClick={goBackToSearch}>
          &larr; Kembali ke Hasil Pencarian
        </button>
      ) : (
        <div className="search-container">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari judul anime..."
            onKeyUp={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch} disabled={loading}>
            {loading ? 'Mencari...' : 'Cari'}
          </button>
        </div>
      )}

      {/* Area Konten Dinamis */}
      <div className="content-area">
        {loading && <div className="loading">Memuat...</div>}

        {/* Tampilan Daftar Episode */}
        {!loading && view === 'episodes' && (
          <>
            <h2 className="results-header">{currentTitle}</h2>
            <div className="card-grid">
              {episodes.length > 0 ? (
                episodes.map((ep) => (
                  <div
                    key={ep.slug}
                    className="card episode-card"
                    onClick={() => fetchStreamingLink(ep.slug, ep.title)}
                  >
                    <div className="card-content">
                      <div className="card-title">{ep.title}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p>Tidak ada episode ditemukan.</p>
              )}
            </div>
          </>
        )}

        {/* Tampilan Hasil Pencarian */}
        {!loading && view === 'search' && results.length > 0 && (
          <>
            <h2 className="results-header">Hasil Pencarian</h2>
            <div className="card-grid">
              {results.map((anime) => (
                <div
                  key={anime.slug}
                  className="card"
                  onClick={() => fetchAnimeDetails(anime.slug, anime.title)}
                >
                  <img src={anime.thumbnail} alt={anime.title} />
                  <div className="card-content">
                    <div className="card-title">{anime.title}</div>
                    <div className="card-subtitle">{anime.type || 'Anime'}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
