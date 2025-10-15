$(document).ready(function () {
    console.log('auth.js loaded - Version: 2025-10-14');

    // Bootstrap Toast Alert Function
    function showAlert(message, type = 'danger') {
        console.log(`showAlert: ${message} (${type})`);
        if ($('#toastContainer').length === 0) {
            $('body').append('<div id="toastContainer" class="position-fixed top-0 end-0 p-3" style="z-index: 1055;"></div>');
        }

        const toastId = `toast-${Date.now()}`;
        const bgClass = {
            danger: 'bg-danger text-white',
            success: 'bg-success text-white',
            warning: 'bg-warning text-dark'
        }[type] || 'bg-danger text-white';

        const sanitizedMessage = $('<div/>').text(message).html();

        const toastHtml = `
            <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="true" data-bs-delay="4000" style="min-width: 300px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);">
                <div class="toast-body ${bgClass} d-flex align-items-center justify-content-between p-3">
                    <span>${sanitizedMessage}</span>
                    <button type="button" class="btn-close btn-close-white ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        `;

        $('#toastContainer').append(toastHtml);
        const $toastElement = $(`#${toastId}`);
        $toastElement.css({ opacity: 0, transform: 'translateY(-20px)' });
        $toastElement.animate({ opacity: 1, transform: 'translateY(0)' }, 300);
        $toastElement.toast('show');
        $toastElement.on('hidden.bs.toast', function () {
            $(this).animate({ opacity: 0, transform: 'translateY(-20px)' }, 300, function () {
                $(this).remove();
            });
        });
    }

    // Password Toggle Functionality
    $('.toggle-passwords').click(function () {
        const $input = $(this).siblings('input');
        const $icon = $(this);
        if ($input.attr('type') === 'password') {
            $input.attr('type', 'text');
            $icon.removeClass('isax-eye-slash').addClass('isax-eye');
        } else {
            $input.attr('type', 'password');
            $icon.removeClass('isax-eye').addClass('isax-eye-slash');
        }
    });

    // Helper function to validate email
    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Signup Form Submission
    $('#signupForm').submit(function (e) {
        e.preventDefault();
        const $button = $('#signupButton');
        $button.find('.spinner-border').removeClass('d-none');
        $button.prop('disabled', true);

        const formData = {
            name: $('input[name="name"]').val().trim(),
            email: $('input[name="email"]').val().trim(),
            password: $('input[name="password"]').val().trim(),
            confirmPassword: $('input[name="confirmPassword"]').val().trim()
        };

        console.log('Signup Form Data:', formData);

        // Client-side validation
        if (!formData.name || !formData.email || !formData.password || !formData.confirmPassword) {
            showAlert('Please fill in all required fields.', 'warning');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        if (!isValidEmail(formData.email)) {
            showAlert('Please enter a valid email address.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            showAlert('Passwords do not match.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        if (formData.password.length < 8) {
            showAlert('Password must be at least 8 characters long.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        $.ajax({
            url: 'http://localhost:5000/api/auth/signup',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(formData),
            success: function (response) {
                console.log('Signup Success:', response);
                showAlert(response.message || 'Signup successful! Redirecting to login...', 'success');
                setTimeout(() => {
                    window.location.href = 'http://127.0.0.1:5500/html/template/login.html';
                }, 1500);
            },
            error: function (xhr) {
                console.error('Signup Error:', xhr.responseJSON, xhr.status);
                const errorMessage = xhr.responseJSON?.message || 'Error during signup. Please try again.';
                showAlert(errorMessage, 'danger');
                $button.find('.spinner-border').addClass('d-none');
                $button.prop('disabled', false);
            }
        });
    });

    // Signin Form Submission
    $('#signinForm').submit(function (e) {
        e.preventDefault();
        const $button = $('#signinButton');
        $button.find('.spinner-border').removeClass('d-none');
        $button.prop('disabled', true);

        const formData = {
            email: $('input[name="email"]').val().trim(),
            password: $('input[name="password"]').val().trim()
        };

        console.log('Signin Form Data:', formData);

        if (!formData.email || !formData.password) {
            showAlert('Please fill in all required fields.', 'warning');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        if (!isValidEmail(formData.email)) {
            showAlert('Please enter a valid email address.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        $.ajax({
            url: 'http://localhost:5000/api/auth/signin',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(formData),
            success: function (response) {
                console.log('Signin Success:', response);
                console.log('Redirect URL received:', response.redirectUrl);
                if (!response.token || !response.role || !response.redirectUrl) {
                    showAlert('Incomplete response from server. Please try again.', 'danger');
                    $button.find('.spinner-border').addClass('d-none');
                    $button.prop('disabled', false);
                    return;
                }
                localStorage.setItem('token', response.token);
                const validRedirects = [
                    'http://127.0.0.1:5500/html/template/student-dashboard.html',
                    'http://127.0.0.1:5500/html/template/admin-dashboard.html'
                ];
                if (!validRedirects.includes(response.redirectUrl)) {
                    console.error('Invalid redirectUrl:', response.redirectUrl);
                    showAlert('Invalid redirection URL from server.', 'danger');
                    $button.find('.spinner-border').addClass('d-none');
                    $button.prop('disabled', false);
                    return;
                }
                showAlert(`Signin successful. Redirecting to ${response.role} dashboard...`, 'success');
                setTimeout(() => {
                    window.location.href = response.redirectUrl;
                }, 1500);
            },
            error: function (xhr) {
                console.error('Signin Error:', xhr.responseJSON, xhr.status);
                const errorMessage = xhr.responseJSON?.message || 'Error during signin. Please try again.';
                showAlert(errorMessage, 'danger');
                $button.find('.spinner-border').addClass('d-none');
                $button.prop('disabled', false);
            }
        });
    });

    // Forgot Password Form Submission
    $('#forgotPasswordForm').submit(function (e) {
        e.preventDefault();
        const $button = $(this).find('button[type="submit"]');
        $button.find('.spinner-border').removeClass('d-none');
        $button.prop('disabled', true);

        const formData = {
            email: $('input[name="email"]').val().trim()
        };

        console.log('Forgot Password Form Data:', formData);

        if (!formData.email) {
            showAlert('Please enter your email address.', 'warning');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        if (!isValidEmail(formData.email)) {
            showAlert('Please enter a valid email address.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        $.ajax({
            url: 'http://localhost:5000/api/auth/forgot-password',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(formData),
            success: function (response) {
                console.log('Forgot Password Success:', response);
                showAlert(response.message || 'Password reset link and OTP sent! Check your email.', 'success');
                setTimeout(() => {
                    window.location.href = `http://127.0.0.1:5500/html/template/set-password.html?token=${response.resetToken}&email=${encodeURIComponent(formData.email)}`;
                }, 1500);
            },
            error: function (xhr) {
                console.error('Forgot Password Error:', xhr.responseJSON, xhr.status);
                const errorMessage = xhr.responseJSON?.message || 'Error sending reset link. Please try again.';
                showAlert(errorMessage, 'danger');
                $button.find('.spinner-border').addClass('d-none');
                $button.prop('disabled', false);
            }
        });
    });

    // Set Password Form Submission
    $('#setPasswordForm').submit(function (e) {
        e.preventDefault();
        const $button = $(this).find('button[type="submit"]');
        $button.find('.spinner-border').removeClass('d-none');
        $button.prop('disabled', true);

        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const email = urlParams.get('email');

        if (!token || !email) {
            showAlert('Invalid or missing reset token/email. Please try again.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        const formData = {
            token: token,
            email: email,
            password: $('input[name="password"]').val().trim(),
            confirmPassword: $('input[name="confirmPassword"]').val().trim(),
            otp: $('input[name="otp"]').val().trim()
        };

        console.log('Set Password Form Data:', formData);

        if (!formData.password || !formData.confirmPassword || !formData.otp) {
            showAlert('Please fill in all required fields, including OTP.', 'warning');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        if (!isValidEmail(formData.email)) {
            showAlert('Invalid email format.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            showAlert('Passwords do not match.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        if (formData.password.length < 8) {
            showAlert('Password must be at least 8 characters long.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        if (!/^\d{6}$/.test(formData.otp)) {
            showAlert('OTP must be a 6-digit number.', 'danger');
            $button.find('.spinner-border').addClass('d-none');
            $button.prop('disabled', false);
            return;
        }

        $.ajax({
            url: 'http://localhost:5000/api/auth/reset-password',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(formData),
            success: function (response) {
                console.log('Reset Password Success:', response);
                console.log('Redirect URL received:', response.redirectUrl);
                if (!response.role || !response.redirectUrl) {
                    showAlert('Incomplete response from server. Redirecting to login...', 'warning');
                    setTimeout(() => {
                        window.location.href = 'http://127.0.0.1:5500/html/template/login.html';
                    }, 1500);
                    return;
                }
                const validRedirects = [
                    'http://127.0.0.1:5500/html/template/student-dashboard.html',
                    'http://127.0.0.1:5500/html/template/admin-dashboard.html'
                ];
                if (!validRedirects.includes(response.redirectUrl)) {
                    console.error('Invalid redirectUrl:', response.redirectUrl);
                    showAlert('Invalid redirection URL from server.', 'danger');
                    $button.find('.spinner-border').addClass('d-none');
                    $button.prop('disabled', false);
                    return;
                }
                showAlert(`Password reset successful. Redirecting to ${response.role} dashboard...`, 'success');
                setTimeout(() => {
                    window.location.href = response.redirectUrl;
                }, 1500);
            },
            error: function (xhr) {
                console.error('Reset Password Error:', xhr.responseJSON, xhr.status);
                const errorMessage = xhr.responseJSON?.message || 'Error resetting password. Please try again.';
                showAlert(errorMessage, 'danger');
                $button.find('.spinner-border').addClass('d-none');
                $button.prop('disabled', false);
            }
        });
    });
});