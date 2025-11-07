// File: api/get.js
// Ini adalah Vercel Serverless Function yang bertindak sebagai proxy

export default async function handler(request, response) {
    // 1. Ambil 'path' yang ingin dituju dari query
    // Contoh: /api/get?path=/recent akan mengambil 'path' = '/recent'
    const { path } = request.query;

    if (!path) {
        return response.status(400).json({ error: 'Parameter "path" dibutuhkan' });
    }

    // 2. Ambil semua parameter query lain (cth: page=1, q=naruto)
    // Kita buat ulang URL search params
    const searchParams = new URL(request.url, 'http://localhost').searchParams;
    searchParams.delete('path'); // Hapus 'path' agar tidak ikut dikirim ke API target

    // 3. Tentukan URL API target
    const API_BASE_URL = 'https://www.sankavollerei.com/api/anime/samehadaku';
    const targetUrl = `${API_BASE_URL}${path}?${searchParams.toString()}`;

    try {
        // 4. Panggil API sankavollerei dari server Vercel
        const apiResponse = await fetch(targetUrl);

        if (!apiResponse.ok) {
            // Jika API-nya error (cth: 404), teruskan pesan errornya
            const errorData = await apiResponse.text();
            console.error(`API Error: ${apiResponse.status}`, errorData);
            return response.status(apiResponse.status).send(errorData);
        }

        // 5. Ambil data JSON dari API
        const data = await apiResponse.json();

        // 6. Atur Header PENTING untuk browser Anda
        // Izinkan semua domain ('*') untuk mengakses proxy ini
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // Atur cache agar lebih cepat
        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=59'); // Cache 1 jam

        // 7. Kirim data kembali ke frontend (index.html)
        return response.status(200).json(data);

    } catch (error) {
        console.error('Proxy Error:', error.message);
        return response.status(500).json({ 
            error: 'Kesalahan pada server proxy', 
            details: error.message 
        });
    }
}
