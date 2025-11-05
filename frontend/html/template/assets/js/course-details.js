$(document).ready(function() {
    const token = localStorage.getItem('token');
    if (!token) {
        showToast('Please login first.', 'error');
        window.location.href = 'login.html';
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const courseId = urlParams.get('id');
    if (!courseId) {
        showToast('Course ID not provided.', 'error');
        return;
    }

    function showToast(message, type = 'success', duration = 4000) {
        // same as in other files
        const toastContainer = $('#toast-container');
        const toastId = `toast-${Date.now()}`;
        const toastHtml = `
            <div id="${toastId}" class="toast align-items-center ${type === 'success' ? 'toast-success' : 'toast-error'} fade" role="alert" aria-live="assertive" aria-atomic="true" data-bs-delay="${duration}">
                <div class="d-flex">
                    <div class="toast-body">${message}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        `;
        toastContainer.append(toastHtml);
        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement);
        toast.show();
        setTimeout(() => {
            toast.hide();
            $(`#${toastId}`).remove();
        }, duration);
    }

    async function loadCourse() {
        try {
            const course = await $.ajax({
                url: `http://localhost:5000/api/courses/${courseId}`,
                type: 'GET',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const enrolled = await isEnrolled(courseId);

            // Render header
            $('#course-header').html(`
                <div class="position-relative">
                    <img class="img-fluid rounded-2" src="assets/img/course/video-bg.jpg" alt="img">
                    <div class="play-icon" id="play-first-video">
                        <i class="ti ti-player-play-filled fs-28"></i>
                    </div>
                </div>
                <h3 class="mb-2">${course.name}</h3>
                <p class="fs-14 mb-3">${course.description}</p>
                <button id="enroll-btn" class="btn btn-primary">${enrolled ? 'Enrolled' : 'Enroll Now'}</button>
            `);

            // Render videos accordion
            const accordion = $('.accordion');
            course.videos.forEach((video, index) => {
                accordion.append(`
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#video-${index}">
                                ${video.topic}
                            </button>
                        </h2>
                        <div id="video-${index}" class="accordion-collapse collapse">
                            <div class="accordion-body">
                                <iframe src="${video.url.replace('watch?v=', 'embed/')}" width="100%" height="315" allowfullscreen></iframe>
                            </div>
                        </div>
                    </div>
                `);
            });

            // Enroll button
            $('#enroll-btn').on('click', async () => {
                if (enrolled) return;
                try {
                    await $.ajax({
                        url: 'http://localhost:5000/api/dashboard/student/enroll',
                        type: 'POST',
                        headers: { 'Authorization': 'Bearer ' + token },
                        contentType: 'application/json',
                        data: JSON.stringify({ courseId })
                    });
                    showToast('Enrolled successfully!', 'success');
                    $('#enroll-btn').text('Enrolled').prop('disabled', true);
                } catch (err) {
                    showToast('Enrollment failed.', 'error');
                }
            });

            // Play first video
            $('#play-first-video').on('click', () => {
                const firstVideo = course.videos[0];
                if (firstVideo) {
                    $('#video-0').collapse('show');
                }
            });
        } catch (err) {
            showToast('Error loading course.', 'error');
        }
    }

    function isEnrolled(courseId) {
        return $.ajax({
            url: `http://localhost:5000/api/dashboard/student/enrollments`,
            type: 'GET',
            headers: { 'Authorization': 'Bearer ' + token }
        }).then(data => data.some(e => e.courseId === courseId)).catch(() => false);
    }

    loadCourse();
});