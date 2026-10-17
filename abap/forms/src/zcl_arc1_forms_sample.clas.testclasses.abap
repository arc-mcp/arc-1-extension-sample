CLASS ltc_forms DEFINITION DEFERRED.
CLASS zcl_arc1_forms_sample DEFINITION LOCAL FRIENDS ltc_forms.

CLASS lcl_http_server DEFINITION INHERITING FROM cl_http_server CREATE PUBLIC.
ENDCLASS.
CLASS lcl_http_server IMPLEMENTATION.
ENDCLASS.

CLASS ltc_forms DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS request
      IMPORTING kind TYPE string DEFAULT 'so10' name TYPE string DEFAULT 'ZARC1_MISSING_TEXT'
                language TYPE string DEFAULT 'E' verb TYPE string DEFAULT 'GET'
      RETURNING VALUE(server) TYPE REF TO cl_http_server.
    METHODS assert_status IMPORTING server TYPE REF TO cl_http_server expected TYPE i.
    METHODS rejects_writes FOR TESTING.
    METHODS validates_keys FOR TESTING.
    METHODS language_keys FOR TESTING.
    METHODS rejects_text_id_on_form FOR TESTING.
    METHODS text_denied FOR TESTING.
    METHODS form_denied FOR TESTING.
    METHODS smartform_denied FOR TESTING.
    METHODS bounds_utf8_response FOR TESTING.
    METHODS response_headers FOR TESTING.
ENDCLASS.

CLASS ltc_forms IMPLEMENTATION.
  METHOD request.
    server = NEW lcl_http_server( ).
    server->request = NEW cl_http_request( add_c_msg = 1 ).
    server->request->set_method( verb ).
    server->request->set_form_field( name = 'kind' value = kind ).
    server->request->set_form_field( name = 'name' value = name ).
    server->request->set_form_field( name = 'language' value = language ).
  ENDMETHOD.

  METHOD assert_status.
    server->response->get_status( IMPORTING code = DATA(actual) ).
    cl_abap_unit_assert=>assert_equals( act = actual exp = expected msg = server->response->get_cdata( ) ).
  ENDMETHOD.

  METHOD rejects_writes.
    DATA(server) = request( verb = 'POST' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 405 ).
    cl_abap_unit_assert=>assert_equals( act = server->response->get_header_field( 'Allow' ) exp = 'GET' ).
  ENDMETHOD.

  METHOD validates_keys.
    DATA(server) = request( name = '../SECRET' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 400 ).
    server = request( language = 'EN' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 400 ).
    server = request( kind = 'rfc' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 400 ).
    server = request( kind = 'sapscript' name = 'THIS_NAME_IS_TOO_LONG' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 400 ).
  ENDMETHOD.

  METHOD rejects_text_id_on_form.
    DATA(server) = request( kind = 'smartform' ).
    server->request->set_form_field( name = 'textId' value = 'ST' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 400 ).
  ENDMETHOD.

  METHOD language_keys.
    TEST-INJECTION text_authority.
      allowed = abap_false.
    END-TEST-INJECTION.
    DATA(server) = request( language = 'c' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    " A valid lowercase key reaches the authorization check.
    assert_status( server = server expected = 403 ).
    server = request( language = '?' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 400 ).
  ENDMETHOD.

  METHOD text_denied.
    TEST-INJECTION text_authority.
      allowed = abap_false.
    END-TEST-INJECTION.
    DATA(server) = request( ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 403 ).
  ENDMETHOD.

  METHOD form_denied.
    TEST-INJECTION form_authority.
      allowed = abap_false.
    END-TEST-INJECTION.
    DATA(server) = request( kind = 'sapscript' name = 'SYSTEM' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 403 ).
  ENDMETHOD.

  METHOD smartform_denied.
    TEST-INJECTION smartform_authority.
      allowed = abap_false.
    END-TEST-INJECTION.
    DATA(server) = request( kind = 'smartform' name = 'SF_EXAMPLE_01' ).
    NEW zcl_arc1_forms_sample( )->if_http_extension~handle_request( server ).
    assert_status( server = server expected = 403 ).
  ENDMETHOD.

  METHOD bounds_utf8_response.
    DATA(server) = request( ).
    NEW zcl_arc1_forms_sample( )->respond( server = server
      result = VALUE #( status = 200 body = repeat( val = `ü` occ = 524289 ) ) ).
    assert_status( server = server expected = 413 ).
    cl_abap_unit_assert=>assert_true( xsdbool( strlen( server->response->get_cdata( ) ) < 100 ) ).
  ENDMETHOD.

  METHOD response_headers.
    DATA(server) = request( ).
    NEW zcl_arc1_forms_sample( )->respond( server = server result = VALUE #( status = 200 body = '{"version":1}' ) ).
    assert_status( server = server expected = 200 ).
    cl_abap_unit_assert=>assert_equals( act = server->response->get_header_field( 'Cache-Control' ) exp = 'no-store' ).
    cl_abap_unit_assert=>assert_equals( act = server->response->get_header_field( 'X-Content-Type-Options' ) exp = 'nosniff' ).
    cl_abap_unit_assert=>assert_equals( act = server->response->get_cdata( ) exp = '{"version":1}' ).
  ENDMETHOD.
ENDCLASS.
