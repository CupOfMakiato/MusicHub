document.addEventListener('DOMContentLoaded', async () => {
    try {
        //fetch player html
        const response = await fetch('./components/bottom-player/player.html');
        const htmlText = await response.text();

        //put player in index.html
        const bottomPlayerDiv = document.getElementById('bottom-player');
        bottomPlayerDiv.innerHTML = htmlText;
        //render lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }
        // initializePlayer
        window.initializePlayer();
        
    } catch (error) {
        console.error('Failed to load the bottom player component:', error);
    }
});

const selectFileButton = document.getElementById('selectFile')
const openFolderButton = document.getElementById('selectFolder')
const coverImage = document.getElementById('coverImage')
const trackTitle = document.getElementById('trackTitle')
const trackArtist = document.getElementById('trackArtist')
const placeholderCover = window.audioService?.placeholderCover || './assets/music-placeholder.png'

async function loadComponent(
  elementId,
  filePath
) {
  const response = await fetch(filePath);

  const html = await response.text();

  document.getElementById(
    elementId
  ).innerHTML = html;
  
  window.lucide?.createIcons();
}

function initUI() {
    loadComponent(
    "sidebar",
    "./components/sidebar/sidebar.html"
  );

    loadComponent(
    "bottom-player",
    "./components/bottom-player/player.html"
  );
}

initUI();

function updateTrackInfoFromState() {
    const currentTrack = playerState?.getState()?.currentTrack || {}
    const title = currentTrack.title
    const artist = currentTrack.artist
    const image = currentTrack.image

    if (trackTitle) trackTitle.textContent = title || 'Unknown Title'
    if (trackArtist) trackArtist.textContent = artist || 'Unknown Artist'
    if (coverImage) {
        coverImage.src = image || placeholderCover
    }
}

if (coverImage) {
    coverImage.addEventListener('error', () => {
        coverImage.src = placeholderCover
    })
}

function startStateSync() {
    updateTrackInfoFromState()
    window.setInterval(updateTrackInfoFromState, 200)
}

startStateSync()

selectFileButton?.addEventListener('click', async () => {
    try {
        const selectedFile = await window.electronAPI.selectAudioFile()

        if (!selectedFile) {
            console.log('No file selected')
            return
        }

        audioService?.startPlaylist([selectedFile])
    } catch (error) {
        console.error('Failed to select or play audio file:', error)
    }
})

openFolderButton?.addEventListener('click', async () => {
    try {
        const selectedFolder = await window.electronAPI.openFolder()

        if (!selectedFolder) {
            console.log('No folder selected')
            return
        }

        const files = await window.electronAPI.getAudioFilesInFolder(selectedFolder)

        if (!Array.isArray(files) || files.length === 0) {
            playerState?.setCurrentTrack({
                filePath: null,
                title: 'No audio files found',
                artist: 'Select another folder',
                image: placeholderCover,
            })
            playerState?.setPlaylist([])
            playerState?.setCurrentTrackIndex(-1)
            audioService?.clearCurrentMusic()
            return
        }

        audioService?.startPlaylist(files)
    } catch (error) {
        console.error('Failed to open folder or play playlist:', error)
    }
})

