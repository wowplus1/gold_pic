function doGet(e) {
  return handleResponse(e);
}

function doPost(e) {
  return handleResponse(e);
}

function handleResponse(e) {
  // CORS 설정을 위한 기본 반환 객체 셋팅
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    let postData = null;
    if (e.postData && e.postData.contents) {
      try {
        postData = JSON.parse(e.postData.contents);
      } catch(ex) { }
    }

    const action = e.parameter.action || (postData ? postData.action : null);

    if (action === 'uploadImage') {
      if (!postData || !postData.imageBase64) throw new Error('No image provided');
      
      // 사용자가 제공한 '주얼리_사진' 폴더 ID
      const folderId = '19s9pTAxxHa8O4PKcoDPyVTmD8zmNPK7L';
      const folder = DriveApp.getFolderById(folderId);
      
      // 'data:image/jpeg;base64,' 접두사 제거
      const base64Data = postData.imageBase64.split(',')[1];
      
      // 고유한 파일명 생성
      const fileName = (postData.name || 'Jewelry') + '_' + new Date().getTime() + '.jpg';
      const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', fileName);
      
      // 드라이브에 파일 생성 및 권한 설정
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      // 웹에서 바로 표시할 수 있는 이미지 URL 포맷
      const imageUrl = 'https://drive.google.com/uc?export=view&id=' + file.getId();
      
      output.setContent(JSON.stringify({ success: true, url: imageUrl }));
      return output;
    }
    
    // 알 수 없는 액션 처리
    output.setContent(JSON.stringify({ error: 'Unknown action or no action provided.' }));
    return output;

  } catch (error) {
    output.setContent(JSON.stringify({ success: false, error: error.toString() }));
    return output;
  }
}
