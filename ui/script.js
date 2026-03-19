let selectFileButton = document.getElementById('selectFile');

selectFileButton.onclick = async () => {
    const selectedFile = await window.electronAPI.selectAudioFile()
    if (selectedFile) {
        console.log('Selected file:', selectedFile)
    } else {
        console.log('No file selected')
    }
    let audio = new Audio(selectedFile);
    audio.play();
}