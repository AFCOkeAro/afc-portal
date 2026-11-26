<?php
/**
 * AFC Pathway Child — functions.php (AFC-1209).
 *
 * What this file does (and does not do):
 * - Registers the shared pattern category + block styles. No page builders.
 * - Provides the server-side registration handler stub. The WP form POSTs to
 *   admin-post.php; this handler validates, then POSTs server-to-server to the
 *   portal staging endpoint (AFC_PORTAL_REGISTER_URL). WordPress never calls
 *   Directus directly and never holds the public token (AFC-1208 ADR §3).
 * - WP stores no PII: nothing is written to the database here. Nothing.
 *   The only state is the redirect to /register/confirmation with a
 *   server-issued reference (real reference comes from the portal's
 *   ticket_code; on transport failure the visitor sees the failure variant).
 *
 * Open/close: AFC_YSTC_REGISTRATION_OPEN=closed serves the closed notice.
 * This is the config-flag rollback path — not a redeploy.
 */

// Front-end helpers: badge + form primitives used by the shared patterns.
add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style(
		'afc-pathway-child',
		get_stylesheet_directory_uri() . '/assets/afc.css',
		array(),
		'1.2.0'
	);
} );

// Pattern category for the shared family.
add_action( 'init', function () {
	register_block_pattern_category( 'afc', array( 'label' => __( 'AFC', 'afc-pathway-child' ) ) );
} );

// Pill buttons + badge helpers via block styles (kept minimal; tokens live in theme.json).
add_action( 'init', function () {
	register_block_style( 'core/button', array( 'name' => 'afc-pill', 'label' => __( 'AFC pill', 'afc-pathway-child' ) ) );
} );

function afc_portal_register_url() {
	$url = getenv( 'AFC_PORTAL_REGISTER_URL' );
	if ( ! is_string( $url ) || '' === trim( $url ) ) {
		return '';
	}
	return esc_url_raw( trim( $url ) );
}

function afc_registration_is_open() {
	$flag = getenv( 'AFC_YSTC_REGISTRATION_OPEN' );
	return 'open' === strtolower( trim( (string) $flag ) );
}

// Server-side registration stub: audience selector (youth self / guardian for
// teen) + guardian consent gate, then server-to-server POST to the portal.
// FREE event: no payment fields are read, accepted, or forwarded — by design
// there is nowhere to put them.
add_action( 'admin_post_nopriv_afc_ystc_register', 'afc_handle_ystc_register' );
add_action( 'admin_post_afc_ystc_register', 'afc_handle_ystc_register' );

function afc_handle_ystc_register() {
	$confirm = home_url( '/register/confirmation/' );
	if ( ! afc_registration_is_open() ) {
		wp_safe_redirect( add_query_arg( 'status', 'closed', $confirm ) );
		exit;
	}
	check_admin_referer( 'afc_ystc_register' );

	$audience = isset( $_POST['audience'] ) ? sanitize_key( wp_unslash( $_POST['audience'] ) ) : '';
	if ( ! in_array( $audience, array( 'youth-self', 'guardian-teen' ), true ) ) {
		wp_safe_redirect( add_query_arg( 'status', 'invalid', $confirm ) );
		exit;
	}
	$name   = isset( $_POST['full_name'] ) ? sanitize_text_field( wp_unslash( $_POST['full_name'] ) ) : '';
	$phone  = isset( $_POST['phone'] ) ? preg_replace( '/[^0-9]/', '', (string) wp_unslash( $_POST['phone'] ) ) : '';
	$branch = isset( $_POST['branch'] ) ? sanitize_text_field( wp_unslash( $_POST['branch'] ) ) : '';
	if ( '' === $name || 11 !== strlen( $phone ) ) {
		wp_safe_redirect( add_query_arg( 'status', 'invalid', $confirm ) );
		exit;
	}
	// Guardian path: consent checkbox is mandatory (portal enforces again).
	if ( 'guardian-teen' === $audience && empty( $_POST['guardian_consent'] ) ) {
		wp_safe_redirect( add_query_arg( 'status', 'consent-required', $confirm ) );
		exit;
	}

	$portal = afc_portal_register_url();
	if ( '' === $portal ) {
		// Fail closed: no endpoint configured means registration is closed,
		// never an open door that drops data.
		wp_safe_redirect( add_query_arg( 'status', 'closed', $confirm ) );
		exit;
	}

	$response = wp_remote_post( $portal, array(
		'timeout' => 15,
		'headers' => array( 'Content-Type' => 'application/json' ),
		'body'    => wp_json_encode( array(
			'audience' => $audience,
			'name'     => $name,
			'phone'    => $phone,
			'branch'   => $branch,
			// No payment fields. No token. The portal issues ticket_code.
		) ),
	) );
	if ( is_wp_error( $response ) ) {
		wp_safe_redirect( add_query_arg( 'status', 'error', $confirm ) );
		exit;
	}
	$code = wp_remote_retrieve_response_code( $response );
	if ( 200 !== (int) $code && 201 !== (int) $code ) {
		$status = 409 === (int) $code ? 'waitlisted' : 'error';
		wp_safe_redirect( add_query_arg( 'status', $status, $confirm ) );
		exit;
	}
	$body = json_decode( wp_remote_retrieve_body( $response ), true );
	$ref  = is_array( $body ) && isset( $body['ticket_code'] ) ? sanitize_text_field( (string) $body['ticket_code'] ) : '';
	wp_safe_redirect( add_query_arg( array( 'status' => 'success', 'ref' => $ref ), $confirm ) );
	exit;
}
